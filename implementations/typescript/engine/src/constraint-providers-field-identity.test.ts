import { afterEach, describe, expect, test } from "bun:test";
import {
  constraintFieldsFor,
  getConstraintBinding,
  getConstraintProvider,
  hasConstraintBinding,
  listConstraintBindings,
  registerConstraintBinding,
  registerConstraintProvider,
  resolveConstraint,
  resolveConstraints,
  unregisterConstraintBinding,
  unregisterConstraintProvider,
} from "./constraint-providers";
import type {
  ConstraintBinding,
  ConstraintProvider,
  ProviderFieldTarget,
  ProviderScope,
} from "./types";
import { REPOSITORY_IDENTITY_MANIFEST } from "./repository-identity-manifest";
import { repositoryProviderScope } from "./system-entities";

const FIELD = { $ref: "00000000-0000-4000-8000-000000000301" } as const;
const OTHER = { $ref: "00000000-0000-4000-8000-000000000302" } as const;
const scopeA: ProviderScope = {
  $tag: "AccountProviderScope",
  accountId: "account-a",
  registryId: "constraint-registry-a",
};
const scopeB: ProviderScope = {
  $tag: "AccountProviderScope",
  accountId: "account-b",
  registryId: "constraint-registry-b",
};
const target = (
  scope: ProviderScope,
  field: ProviderFieldTarget["field"] = FIELD,
  owner = "Profile",
): ProviderFieldTarget => ({
  scope,
  owner,
  field,
});
const binding = (scope: ProviderScope): ConstraintBinding => ({
  target: target(scope),
  provider: "org-policy",
});
const provider: ConstraintProvider = {
  name: "org-policy",
  resolve: async (requested) => ({
    $tag: "SeEnum",
    values: [requested.field.$ref],
  }),
};

afterEach(() => {
  for (const scope of [scopeA, scopeB]) {
    unregisterConstraintProvider(scope, "org-policy");
    unregisterConstraintProvider(scope, "other-policy");
    unregisterConstraintBinding(target(scope));
    unregisterConstraintBinding(target(scope, OTHER));
    unregisterConstraintBinding(target(scope, FIELD, "OtherProfile"));
  }
});

describe("constraint provider field identity", () => {
  test("repository provider scope tracks the generated identity snapshot", () => {
    expect(repositoryProviderScope).toEqual({
      $tag: "RepositoryProviderScope",
      registryId: REPOSITORY_IDENTITY_MANIFEST.digest,
    });
  });

  test("registration is scoped, UUID-keyed, and duplicate/conflict structured", () => {
    expect(registerConstraintProvider(scopeA, provider).$tag).toBe("ProviderRegistered");
    expect(registerConstraintProvider(scopeA, provider).$tag).toBe("ProviderDuplicate");
    expect(getConstraintProvider(scopeA, "org-policy").$tag).toBe("ProviderFound");
    expect(getConstraintProvider(scopeB, "org-policy").$tag).toBe("ProviderMissing");

    expect(registerConstraintBinding(binding(scopeA)).$tag).toBe("ProviderRegistered");
    expect(registerConstraintBinding(binding(scopeA)).$tag).toBe("ProviderDuplicate");
    expect(registerConstraintBinding({
      ...binding(scopeA),
      provider: "other-policy",
    }).$tag).toBe("ProviderConflict");
    expect(getConstraintBinding(target(scopeA)).$tag).toBe("ProviderFound");
    expect(hasConstraintBinding(target(scopeA))).toBe(true);
  });

  test("constraint provider and binding identity accessors stay inert", () => {
    let nameGetterReads = 0;
    const accessorProvider = Object.create(null) as ConstraintProvider;
    Object.defineProperty(accessorProvider, "name", {
      enumerable: true,
      get() {
        nameGetterReads += 1;
        throw new Error("constraint provider name accessor must stay inert");
      },
    });
    Object.defineProperty(accessorProvider, "resolve", {
      value: async () => ({ $tag: "SeAll" }),
      enumerable: true,
    });
    expect(registerConstraintProvider(scopeA, accessorProvider).$tag)
      .toBe("ProviderInvalid");
    expect(nameGetterReads).toBe(0);

    let targetGetterReads = 0;
    const accessorBinding = { provider: "org-policy" } as ConstraintBinding;
    Object.defineProperty(accessorBinding, "target", {
      enumerable: true,
      get() {
        targetGetterReads += 1;
        throw new Error("constraint target accessor must stay inert");
      },
    });
    expect(registerConstraintBinding(accessorBinding).$tag)
      .toBe("ProviderInvalid");
    expect(targetGetterReads).toBe(0);
  });

  test("account A cannot enumerate or resolve account B bindings", async () => {
    registerConstraintProvider(scopeA, provider);
    registerConstraintProvider(scopeB, provider);
    registerConstraintBinding(binding(scopeA));
    registerConstraintBinding(binding(scopeB));

    expect(listConstraintBindings(scopeA)).toEqual([binding(scopeA)]);
    expect(listConstraintBindings(scopeB)).toEqual([binding(scopeB)]);
    expect(constraintFieldsFor(scopeA, "Profile")).toEqual([target(scopeA)]);
    const a = await resolveConstraint(target(scopeA));
    expect(a?.target).toEqual(target(scopeA));
    expect(a?.constraint).toEqual({ $tag: "SeEnum", values: [FIELD.$ref] });
  });

  test("Fenel owner selection cannot enumerate another owner's target", () => {
    registerConstraintBinding(binding(scopeA));
    registerConstraintBinding({
      target: target(scopeA, FIELD, "OtherProfile"),
      provider: "org-policy",
    });
    expect(constraintFieldsFor(scopeA, "Profile")).toEqual([target(scopeA)]);
    expect(constraintFieldsFor(scopeA, "OtherProfile")).toEqual([
      target(scopeA, FIELD, "OtherProfile"),
    ]);
  });

  test("batch selection/merge remains identity-bearing and reports missing rows", async () => {
    registerConstraintProvider(scopeA, provider);
    registerConstraintBinding(binding(scopeA));
    const result = await resolveConstraints([target(scopeA), target(scopeA, OTHER)]);
    expect(result.resolutions).toEqual([{
      target: target(scopeA),
      constraint: { $tag: "SeEnum", values: [FIELD.$ref] },
    }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.target).toEqual(target(scopeA, OTHER));
    expect(result.errors[0]?.message).toContain("missing");
  });

  test("async failure publishes no cached success or partial merged result", async () => {
    let fail = true;
    const flaky: ConstraintProvider = {
      name: "org-policy",
      resolve: async () => {
        if (fail) throw new Error("remote unavailable");
        return { $tag: "SeAll" };
      },
    };
    registerConstraintProvider(scopeA, flaky);
    registerConstraintBinding(binding(scopeA));
    await expect(resolveConstraints([target(scopeA)])).rejects.toThrow("remote unavailable");
    fail = false;
    expect((await resolveConstraints([target(scopeA)])).resolutions[0]?.constraint)
      .toEqual({ $tag: "SeAll" });
  });

  test("constraint IO capabilities must be own data functions and accessors stay inert", async () => {
    let resolveGetterReads = 0;
    const accessorProvider = { name: "org-policy" } as ConstraintProvider;
    Object.defineProperty(accessorProvider, "resolve", {
      enumerable: true,
      get() {
        resolveGetterReads += 1;
        throw new Error("resolve accessor must stay inert");
      },
    });
    registerConstraintProvider(scopeA, accessorProvider);
    registerConstraintBinding(binding(scopeA));
    const stored = getConstraintProvider(scopeA, "org-policy");
    expect(stored.$tag).toBe("ProviderFound");
    if (stored.$tag === "ProviderFound") {
      expect(Object.getPrototypeOf(stored.value)).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(stored.value, "resolve")).toBe(false);
    }
    expect(resolveGetterReads).toBe(0);

    await expect(resolveConstraints([target(scopeA)]))
      .rejects.toThrow("resolve must be an own data function");
    expect(resolveGetterReads).toBe(0);
  });

  test("non-enumerable own constraint capability and receiver state survive registration", async () => {
    const nonEnumerable = Object.create(null) as ConstraintProvider & {
      resultTag: "SeAll";
    };
    Object.defineProperty(nonEnumerable, "name", {
      value: "org-policy",
      enumerable: true,
    });
    Object.defineProperty(nonEnumerable, "resultTag", {
      value: "SeAll",
      enumerable: false,
    });
    Object.defineProperty(nonEnumerable, "resolve", {
      value: async function (this: { resultTag: "SeAll" }) {
        return { $tag: this.resultTag } as const;
      },
      enumerable: false,
    });
    expect(registerConstraintProvider(scopeA, nonEnumerable).$tag)
      .toBe("ProviderRegistered");
    registerConstraintBinding(binding(scopeA));
    expect((await resolveConstraint(target(scopeA)))?.constraint)
      .toEqual({ $tag: "SeAll" });
  });

  test("undefined provider rows are omitted by Fenel merge policy", async () => {
    registerConstraintProvider(scopeA, {
      name: "org-policy",
      resolve: async () => undefined,
    });
    registerConstraintBinding(binding(scopeA));
    expect(await resolveConstraints([target(scopeA)])).toEqual({
      resolutions: [],
      errors: [],
    });
    expect(await resolveConstraint(target(scopeA))).toBeUndefined();
  });
});
