import { describe, expect, test } from "bun:test";

import { createDispatchRegistry } from "./dispatch-registry";
import { seedFromType } from "./effect-dispatch";
import { aiCapabilities, aiProviders } from "./modules/ai";
import { ecomCapabilities, ecomProviders } from "./modules/ecom";
import { emailCapabilities, emailModule, emailProviders } from "./modules/email";
import { telegramCapabilities, telegramModule } from "./modules/telegram";
import { createRegistry } from "./registry";
import {
  deriveRegisteredCapabilityMethodCallables,
  finalizeRegistryFunctionSignatures,
  inferJsonLogicType,
  SignatureAnnotationRequiredError,
  type RegistryFunctionSignatureCandidate,
  type SignatureResolutionRow,
} from "./signature-inference";
import { Nothing } from "./type-foundation";
import type {
  FenelModule,
  FenelType,
  FieldDef,
  Interface,
  TypeScheme,
} from "./types";

const ref = (name: string): FenelType => ({ $ref: name });
const variable = (name: string): FenelType => ({ $var: name });

function namedField(
  name: string,
  handle: string,
  type: FenelType,
): FieldDef {
  return {
    name,
    key: { $tag: "NamedField", ref: { $ref: handle } },
    label: Nothing,
    type,
    meta: {},
    ui: Nothing,
  };
}

function methodField(
  name: string,
  ordinal: number,
  type: FenelType,
): FieldDef {
  return namedField(
    name,
    `10000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    type,
  );
}

function recordScheme(
  fields: readonly FieldDef[],
  rest: Omit<TypeScheme, "body"> = { quantified: [] },
): TypeScheme {
  return {
    ...rest,
    body: { $record: { fields: [...fields] } },
  };
}

function capability(name: string, interfaces: readonly Interface[]): Interface {
  const found = interfaces.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`missing live ${name} capability`);
  return found;
}

function entityProjection(module: FenelModule): FenelModule {
  return {
    name: module.name,
    label: `${module.label ?? module.name} capability nominal projection`,
    entities: module.entities ?? [],
    functions: [],
    instances: [],
  };
}

describe("Fenel capability-method scheme projection", () => {
  test("owns scalar/nullary, curried, kinded, and dotted-owner projection", () => {
    const first = namedField(
      "first",
      "20000000-0000-4000-8000-000000000001",
      ref("Number"),
    );
    const second = namedField(
      "second",
      "20000000-0000-4000-8000-000000000002",
      ref("Boolean"),
    );
    const curried: FenelType = {
      $arrow: {
        params: [first],
        returns: {
          $arrow: {
            params: [second],
            returns: ref("String"),
          },
        },
      },
    };
    const kType = { $tag: "KType" } as const;
    const unaryKind = { $tag: "KArrow", input: kType, output: kType } as const;
    const applied: FenelType = { $el: { call: ["f", variable("a")] } };

    const callables = deriveRegisteredCapabilityMethodCallables([
      {
        entity: {
          ownerName: "A",
          typeScheme: recordScheme([
            methodField("ping", 1, ref("String")),
          ]),
        },
        selectedMethods: ["ping"],
      },
      {
        entity: {
          ownerName: "A.B",
          typeScheme: recordScheme([
            methodField("ping", 2, curried),
          ]),
        },
        selectedMethods: ["ping"],
      },
      {
        entity: {
          ownerName: "Higher",
          typeScheme: recordScheme(
            [methodField("lift", 3, applied)],
            {
              quantified: [
                { id: "qf", sourceName: "f", kind: unaryKind },
                { id: "qa", sourceName: "a", kind: kType },
              ],
              applications: [{
                path: ["$record", "fields", "0", "type"],
                headVarId: "qf",
                args: [variable("a")],
                kind: unaryKind,
              }],
            },
          ),
        },
        selectedMethods: ["lift"],
      },
    ], (_owner, names) => names.map((name) => ({
      name,
      status: "missing",
      targetId: "",
    })));

    expect(callables.map(({ targetId }) => targetId)).toEqual([
      "A.ping",
      "A.B.ping",
      "Higher.lift",
    ]);

    const scalar = callables[0]!;
    expect(scalar.ownerName).toBe("A");
    expect(scalar.params).toEqual([]);
    expect(scalar.returns).toEqual(ref("String"));

    const dottedOwner = callables[1]!;
    expect(dottedOwner.ownerName).toBe("A.B");
    expect(dottedOwner.params.map(({ name }) => name)).toEqual(["first", "second"]);
    expect(dottedOwner.returns).toEqual(ref("String"));

    const higher = callables[2]!;
    expect(higher.params).toEqual([]);
    expect(higher.scheme.quantified).toEqual([
      { id: "qf", sourceName: "f", kind: unaryKind },
      { id: "qa", sourceName: "a", kind: kType },
    ]);
    expect(higher.returns).toEqual(applied);
    expect(higher.scheme.applications).toEqual([{
      path: ["$arrow", "returns"],
      headVarId: "qf",
      args: [variable("a")],
      kind: unaryKind,
    }]);
    expect(callables.map(({ trust }) => trust)).toEqual(callables.map(() => ({
      $tag: "Advisory",
      reason: "registered dispatch-interface contracts are not SC-sig certificates",
    })));
  }, 180_000);

  test("joins every exact fence in Fenel with Invalid dominance for browser and top-level inference", () => {
    const annotation = {
      $tag: "AnnotationRequired",
      diagnostics: [{
        code: "capability.annotation",
        functionId: "Alpha.read",
        message: "alpha requires an annotation",
        path: ["alpha", "read"],
      }],
    } as const;
    const invalid = {
      $tag: "Invalid",
      diagnostics: [{
        code: "capability.invalid",
        functionId: "Zeta.write",
        message: "zeta contract is invalid",
        path: ["zeta", "write"],
      }],
    } as const;
    const logic = {
      do: [
        { call: ["Zeta.write"] },
        { call: ["Alpha.read"] },
      ],
    };
    const resolveFunction = (name: string) => {
      const signatureOutcome = name === "Alpha.read"
        ? annotation
        : name === "Zeta.write"
        ? invalid
        : undefined;
      return signatureOutcome === undefined
        ? undefined
        : {
            params: [],
            returns: ref("String"),
            targetId: name,
            signatureOutcome,
          };
    };

    const browser = inferJsonLogicType(logic, { resolveFunction });
    expect(browser.outcome).toEqual({
      $tag: "Invalid",
      diagnostics: [...annotation.diagnostics, ...invalid.diagnostics],
    });

    const fn = {
      id: "capability-fence-consumer:invoke",
      params: [],
      returns: { $var: "compat-return" },
      body: logic,
    };
    const candidate: RegistryFunctionSignatureCandidate = {
      fn,
      declaration: {
        functionId: fn.id,
        declarationName: "invoke",
        codeName: "invoke",
        params: [],
        returns: { $tag: "Absent" },
      },
      implementationOrigin: { $tag: "FenelBody" },
    };
    const fenced = (
      name: string,
      outcome: typeof annotation | typeof invalid,
    ): SignatureResolutionRow => ({
      name,
      targetId: name,
      status: "fenced",
      verdict: outcome.$tag,
      diagnostics: outcome.diagnostics,
    });
    try {
      finalizeRegistryFunctionSignatures([candidate], {
        resolutions: [
          fenced("Zeta.write", invalid),
          fenced("Alpha.read", annotation),
        ],
      });
      throw new Error("expected the missing-signature batch to fence");
    } catch (error) {
      expect(error).toBeInstanceOf(SignatureAnnotationRequiredError);
      if (!(error instanceof SignatureAnnotationRequiredError)) return;
      expect(error.outcomeTag).toBe("Invalid");
      expect(error.diagnostics).toEqual([
        ...annotation.diagnostics,
        ...invalid.diagnostics,
      ]);
    }

    const duplicateCandidate = (id: string): RegistryFunctionSignatureCandidate => {
      const duplicateFn = {
        id,
        params: [],
        returns: { $var: "compat-return" } as FenelType,
        body: { call: ["Shared.method"] },
      };
      return {
        fn: duplicateFn,
        declaration: {
          functionId: id,
          declarationName: id,
          codeName: id,
          params: [],
          returns: { $tag: "Absent" },
        },
        implementationOrigin: { $tag: "FenelBody" },
      };
    };
    const annotationCandidate = duplicateCandidate("fence-join:annotation");
    const invalidCandidate = duplicateCandidate("fence-join:invalid");
    const duplicateFrameOutcome = (
      candidates: readonly RegistryFunctionSignatureCandidate[],
    ): SignatureAnnotationRequiredError => {
      try {
        finalizeRegistryFunctionSignatures(candidates, {
          resolutions: [],
          resolveCandidateReferences: (functionId, names) => names.map((name) => {
            const outcome = functionId === annotationCandidate.fn.id
              ? annotation
              : invalid;
            return fenced(
              name,
              outcome,
            ) satisfies SignatureResolutionRow;
          }).map((row) => ({
            ...row,
            targetId: row.verdict === "AnnotationRequired"
              ? "Alpha.capability-target"
              : "Zeta.capability-target",
          })),
        });
      } catch (error) {
        if (error instanceof SignatureAnnotationRequiredError) return error;
        throw error;
      }
      throw new Error("expected duplicate-spelling candidate frames to fence");
    };
    for (const error of [
      duplicateFrameOutcome([annotationCandidate, invalidCandidate]),
      duplicateFrameOutcome([invalidCandidate, annotationCandidate]),
    ]) {
      expect(error.outcomeTag).toBe("Invalid");
      expect(error.diagnostics).toEqual([
        ...annotation.diagnostics,
        ...invalid.diagnostics,
      ]);
    }
  }, 180_000);

  test("fails closed without exact nominal provenance but accepts complete attached identities", () => {
    const unscoped = ref("UnscopedCapabilityNominal");
    const unscopedScheme = recordScheme([
      methodField("read", 20, unscoped),
    ]);
    const pinnedScheme: TypeScheme = {
      ...recordScheme([methodField("read", 21, unscoped)]),
      nominals: [{
        path: ["$record", "fields", "0", "type"],
        identity: '["external-contract","UnscopedCapabilityNominal"]',
        publicName: "UnscopedCapabilityNominal",
      }],
    };
    const unscopedProbe = seedFromType(
      "UnscopedCapabilityProbe",
      unscopedScheme.body,
      "a",
      { typeScheme: unscopedScheme },
    );
    const pinnedProbe = seedFromType(
      "PinnedCapabilityProbe",
      pinnedScheme.body,
      "a",
      { typeScheme: pinnedScheme },
    );
    const dispatch = createDispatchRegistry();
    dispatch.defineClass(unscopedProbe);
    dispatch.defineClass(pinnedProbe);
    const unrelatedNominalType: FenelType = { $record: { fields: [] } };
    const registry = createRegistry([{
      name: "unrelated-global-nominal",
      label: "Unrelated global nominal",
      entities: [{
        id: "UnscopedCapabilityNominal",
        module: "unrelated-global-nominal",
        type: unrelatedNominalType,
        typeScheme: { quantified: [], body: unrelatedNominalType },
      }],
      functions: [],
      instances: [],
    }], {
      dispatchRegistry: dispatch,
      publishCatalogEntities: false,
    });

    const unscopedRow = registry.getCapabilityMethodSignature(
      "UnscopedCapabilityProbe.read",
    );
    expect(unscopedRow?.outcome.$tag).toBe("AnnotationRequired");
    expect(unscopedRow?.scheme).toBeUndefined();
    expect(unscopedRow?.outcome).toHaveProperty(
      "diagnostics.0.code",
      "inference.capability-nominal-provenance",
    );

    const pinnedRow = registry.getCapabilityMethodSignature(
      "PinnedCapabilityProbe.read",
    );
    expect(pinnedRow?.outcome.$tag).toBe("Solved");
    expect(pinnedRow?.scheme?.nominals).toEqual([{
      path: ["$arrow", "returns"],
      identity: '["external-contract","UnscopedCapabilityNominal"]',
      publicName: "UnscopedCapabilityNominal",
    }]);
  }, 180_000);
});

describe("registered production capability contracts", () => {
  test("resolves method nominals in the exact interface source-module frame", () => {
    const sharedType: FenelType = { $record: { fields: [] } };
    const probeType: FenelType = {
      $record: {
        fields: [methodField("value", 10, ref("Shared"))],
      },
    };
    const probeScheme: TypeScheme = { quantified: [], body: probeType };
    const left: FenelModule = {
      name: "left",
      label: "Left",
      functions: [],
      instances: [],
      entities: [
        {
          id: "Shared",
          module: "left",
          type: sharedType,
          typeScheme: { quantified: [], body: sharedType },
        },
        {
          id: "Probe",
          module: "left",
          type: probeType,
          typeScheme: probeScheme,
        },
      ],
    };
    const right: FenelModule = {
      name: "right",
      label: "Right",
      functions: [],
      instances: [],
      entities: [{
        id: "Shared",
        module: "right",
        type: sharedType,
        typeScheme: { quantified: [], body: sharedType },
      }],
    };
    const probe = seedFromType("Probe", probeType, "a", {
      typeScheme: probeScheme,
      sourceModule: left,
    });

    for (const modules of [[left, right], [right, left]]) {
      const dispatch = createDispatchRegistry();
      dispatch.defineClass(probe);
      const registry = createRegistry(modules, {
        dispatchRegistry: dispatch,
        publishCatalogEntities: false,
      });
      const row = registry.getCapabilityMethodSignature("Probe.value");

      expect(row?.outcome.$tag).toBe("Solved");
      expect(row?.scheme?.nominals).toEqual([{
        path: ["$arrow", "returns"],
        identity: "[\"left\",\"Shared\"]",
        publicName: "Shared",
      }]);
    }
  }, 180_000);

  test("publishes live Fenel schemes independently of provider payload shapes", () => {
    const ai = capability("AI", aiCapabilities);
    const email = capability("EmailService", emailCapabilities);
    const telegramMessages = capability("TelegramMessages", telegramCapabilities);
    const messaging = capability("Messaging", ecomCapabilities);
    const payment = capability("Payment", ecomCapabilities);

    const dispatch = createDispatchRegistry();
    for (const cls of [ai, email, telegramMessages, messaging, payment]) {
      dispatch.defineClass(cls);
    }
    for (const provider of [
      ...aiProviders,
      ...emailProviders,
      ...ecomProviders.filter(({ typeName }) =>
        typeName === "Messaging" || typeName === "Payment"
      ),
    ]) {
      dispatch.addInstance(provider);
    }

    const registry = createRegistry([
      entityProjection(emailModule),
      entityProjection(telegramModule),
    ], {
      dispatchRegistry: dispatch,
      publishCatalogEntities: false,
    });

    const aiComplete = registry.getCapabilityMethodSignature("AI.complete");
    expect(aiComplete?.outcome.$tag).toBe("Solved");
    expect(aiComplete?.params).toHaveLength(4);
    expect(registry.resolveCapabilityMethod("AI.complete")?.spec).toBe(
      "AI.openai.complete",
    );

    const domainAdd = registry.getCapabilityMethodSignature("EmailService.domainAdd");
    expect(domainAdd?.outcome.$tag).toBe("Solved");
    expect(domainAdd?.params).toHaveLength(1);
    expect(domainAdd?.returns).toEqual(ref("SendingDomain"));
    expect(registry.getCapabilityMethodSignature("EmailService.domain_add")).toBeUndefined();
    expect(registry.listCapabilityMethodSignatures().some(
      ({ targetId }) => targetId === "EmailService.domain_add",
    )).toBeFalse();

    const sendMessage = registry.getCapabilityMethodSignature(
      "TelegramMessages.sendMessage",
    );
    expect(sendMessage?.outcome.$tag).toBe("Solved");
    expect(sendMessage?.params[2]?.type).toEqual(ref("MessageText"));

    // Messaging/Payment were AnnotationRequired while they lived as
    // unannotated ecom TypeScript `Interface` literals. Phase-4 slice 1
    // (a3eda546) consolidated them onto `fenel/modules/ecom/capability.fenel`
    // with their live contracts written as real arrows, so they now publish
    // exact source-derived schemes. That STRENGTHENS this test's thesis —
    // the scheme comes from the interface declaration, never from the
    // provider payload — so the assertions move to the solved shape rather
    // than being relaxed.
    const messagingSend = registry.getCapabilityMethodSignature("Messaging.send");
    expect(messagingSend?.outcome.$tag).toBe("Solved");
    expect(messagingSend?.scheme).toBeDefined();
    expect(messagingSend?.params).toHaveLength(4);
    const selectedMessaging = registry.resolveCapabilityMethod("Messaging.send");
    expect(selectedMessaging?.provider.args).toEqual(["sms"]);
    // Slice 1 also moved the ecom PROVIDERS to Fenel instance sources, so the
    // provider's method value is now a handler-key routing payload — a plain
    // string — rather than a legacy method record. That is the posture the
    // brief requires ("handler identifiers may remain routing payloads only;
    // neither they nor provider records become scheme/certificate
    // authority"), and it is a sharper statement of this test's thesis than
    // the old arity check: the provider carries no params at all to confuse
    // with the declaration's scheme.
    expect(typeof selectedMessaging?.spec).toBe("string");
    expect(selectedMessaging?.spec).toBe("Messaging.sms.send");

    const createCheckout = registry.getCapabilityMethodSignature(
      "Payment.create_checkout",
    );
    expect(createCheckout?.outcome.$tag).toBe("Solved");
    expect(createCheckout?.scheme).toBeDefined();
    expect(createCheckout?.params).toHaveLength(4);
    const selectedPayment = registry.resolveCapabilityMethod("Payment.create_checkout");
    expect(selectedPayment?.provider.args).toEqual(["stripe"]);
    expect(typeof selectedPayment?.spec).toBe("string");
    expect(selectedPayment?.spec).toBe("Payment.stripe.create_checkout");
  }, 600_000);
});
