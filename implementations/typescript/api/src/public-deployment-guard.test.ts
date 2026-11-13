// GP-25 — the public-deployment boot guard refuses each forbidden variable and
// a non-production NODE_ENV, and leaves a deployment without the flag alone.

import { describe, expect, it, spyOn } from "bun:test";
import {
  apiListenHostname,
  enforcePublicDeploymentGuard,
  FORBIDDEN_ON_PUBLIC_DEPLOYMENT,
  publicDeploymentRefusals,
} from "./public-deployment-guard";

const PUBLIC = { FENEL_PUBLIC_DEPLOYMENT: "1", NODE_ENV: "production" };

describe("publicDeploymentRefusals", () => {
  it("passes a clean public deployment", () => {
    expect(publicDeploymentRefusals(PUBLIC)).toEqual([]);
  });

  for (const name of FORBIDDEN_ON_PUBLIC_DEPLOYMENT) {
    it(`refuses when ${name} is set`, () => {
      expect(publicDeploymentRefusals({ ...PUBLIC, [name]: "secret" })).toEqual([`${name} is set`]);
    });
  }

  it("treats an empty forbidden variable as unset", () => {
    expect(publicDeploymentRefusals({ ...PUBLIC, ADMIN_TOKEN: "" })).toEqual([]);
  });

  it("refuses a non-production NODE_ENV, set or unset", () => {
    expect(publicDeploymentRefusals({ ...PUBLIC, NODE_ENV: "development" }))
      .toEqual([`NODE_ENV is "development", not "production"`]);
    expect(publicDeploymentRefusals({ FENEL_PUBLIC_DEPLOYMENT: "1" }))
      .toEqual([`NODE_ENV is unset, not "production"`]);
  });

  it("accepts a loopback API_HOST and refuses any other", () => {
    for (const host of ["127.0.0.1", "::1", "localhost", "127.0.0.2"]) {
      expect(publicDeploymentRefusals({ ...PUBLIC, API_HOST: host })).toEqual([]);
    }
    expect(publicDeploymentRefusals({ ...PUBLIC, API_HOST: "0.0.0.0" }))
      .toEqual([`API_HOST is "0.0.0.0", not a loopback address`]);
    expect(publicDeploymentRefusals({ ...PUBLIC, API_HOST: "203.0.113.5" })).toHaveLength(1);
    // Without the flag, API_HOST is the operator's choice.
    expect(publicDeploymentRefusals({ API_HOST: "0.0.0.0" })).toEqual([]);
  });

  it("lists every reason at once", () => {
    const env: Record<string, string> = { FENEL_PUBLIC_DEPLOYMENT: "true" };
    for (const name of FORBIDDEN_ON_PUBLIC_DEPLOYMENT) env[name] = "x";
    expect(publicDeploymentRefusals(env)).toHaveLength(1 + FORBIDDEN_ON_PUBLIC_DEPLOYMENT.length);
  });

  it("does nothing without the flag (the dev server and staging)", () => {
    const env: Record<string, string> = { NODE_ENV: "development" };
    for (const name of FORBIDDEN_ON_PUBLIC_DEPLOYMENT) env[name] = "x";
    expect(publicDeploymentRefusals(env)).toEqual([]);
    for (const off of ["0", "false", "off", "no", ""]) {
      expect(publicDeploymentRefusals({ ...env, FENEL_PUBLIC_DEPLOYMENT: off })).toEqual([]);
    }
  });
});

describe("enforcePublicDeploymentGuard", () => {
  it("logs one clear line and exits 1 when refused", () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exits: number[] = [];
    try {
      expect(() =>
        enforcePublicDeploymentGuard({ ...PUBLIC, STRIPE_WEBHOOK_SECRET: "whsec" }, (code) => {
          exits.push(code);
          throw new Error("exit");
        }),
      ).toThrow("exit");
      expect(exits).toEqual([1]);
      expect(error).toHaveBeenCalledTimes(1);
      const line = String(error.mock.calls[0]![0]);
      expect(line).toContain("Refusing to start");
      expect(line).toContain("STRIPE_WEBHOOK_SECRET is set");
    } finally {
      error.mockRestore();
    }
  });

  it("returns without exiting when allowed", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      enforcePublicDeploymentGuard(PUBLIC, () => { throw new Error("must not exit"); });
      enforcePublicDeploymentGuard({}, () => { throw new Error("must not exit"); });
    } finally {
      log.mockRestore();
    }
  });
});

describe("apiListenHostname", () => {
  it("binds loopback on a public deployment unless API_HOST says otherwise", () => {
    expect(apiListenHostname(PUBLIC)).toBe("127.0.0.1");
    expect(apiListenHostname({ ...PUBLIC, API_HOST: "::1" })).toBe("::1");
  });

  it("keeps Bun's default elsewhere", () => {
    expect(apiListenHostname({})).toBeUndefined();
    expect(apiListenHostname({ API_HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });
});
