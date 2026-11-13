import { describe, expect, mock, test } from "bun:test";
import type { FenelFunction } from "@fenel/engine/types";

type ResponseResolver = (response: unknown) => void;
let apiFetchImpl: <T>(path: string) => Promise<T> = async () => {
  throw new Error("test API fetch was not installed");
};

mock.module("./api", () => ({
  apiRead: <T>(path: string) => apiFetchImpl<T>(path),
}));

describe("account-scoped user registries", () => {
  test("scope changes revoke synchronously and only the newest load may publish", async () => {
    const pending = new Map<string, ResponseResolver>();
    let requestGeneration = "account-a-old";
    apiFetchImpl = <T>(path: string) =>
      new Promise<T>((resolve) => {
        pending.set(`${requestGeneration}:${path}`, (response) => {
          resolve(response as T);
        });
      });
    const {
      ensureUserRegistriesLoaded,
      reloadUserRegistries,
      setUserRegistryAccountScope,
      userFunctions,
      userViews,
    } = await import("./user-registries");

    const resolveGeneration = (generation: string, fnId: string): void => {
      pending.get(`${generation}:/views`)?.({ views: [] });
      pending.get(`${generation}:/functions`)?.({
        functions: [{
          function: {
            id: fnId,
            params: [],
            returns: { $ref: "String" },
            body: fnId,
          } satisfies FenelFunction,
        }],
      });
      // The loader's third read. It used to be `/dispatch-instances`; answering
      // that path left `/modules/installed` pending, so every load hung.
      pending.get(`${generation}:/modules/installed`)?.({ modules: [] });
    };

    try {
      setUserRegistryAccountScope("account-a");
      const oldLoad = ensureUserRegistriesLoaded("account-a");

      requestGeneration = "account-a-new";
      const newLoad = reloadUserRegistries("account-a");
      resolveGeneration("account-a-old", "account-a:stale");
      await oldLoad;
      expect(userFunctions()).toEqual([]);

      resolveGeneration("account-a-new", "account-a:current");
      await newLoad;
      expect(userFunctions().map((fn) => fn.id)).toEqual(["account-a:current"]);

      requestGeneration = "account-a-late";
      const lateAccountALoad = reloadUserRegistries("account-a");
      requestGeneration = "account-b";
      setUserRegistryAccountScope("account-b");
      expect(userFunctions()).toEqual([]);
      expect(userViews()).toEqual([]);
      const accountBLoad = ensureUserRegistriesLoaded("account-b");

      // Even a very late account-A completion has no publication authority.
      resolveGeneration("account-a-late", "account-a:later-stale");
      await lateAccountALoad;
      expect(userFunctions()).toEqual([]);
      resolveGeneration("account-b", "account-b:current");
      await accountBLoad;
      expect(userFunctions().map((fn) => fn.id)).toEqual(["account-b:current"]);
    } finally {
      setUserRegistryAccountScope(undefined);
      mock.restore();
    }
  });
});
