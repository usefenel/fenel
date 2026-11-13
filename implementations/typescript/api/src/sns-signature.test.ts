import { describe, expect, spyOn, test } from "bun:test";
import { sign, X509Certificate } from "node:crypto";
import {
  confirmSnsSubscription,
  createSnsVerifier,
  InvalidSnsMessageError,
  SnsCertificateUnavailableError,
  snsSubscriptionUrl,
  type SnsFetch,
} from "./sns-signature";
import { createSesWebhookRoutes } from "./routes/ses-webhook";

// Public synthetic key material, generated for these tests. Never AWS keys.
const CERT = await Bun.file(new URL("./test-fixtures/sns-synthetic-cert.pem", import.meta.url)).text();
const KEY = await Bun.file(new URL("./test-fixtures/sns-synthetic-key.pem", import.meta.url)).text();
const certificate = new X509Certificate(CERT);
const SIGNED_AT = Date.parse(certificate.validFrom) + 24 * 60 * 60 * 1000;
const TOPIC = "arn:aws:sns:eu-west-3:123456789012:ses-events";
const CERT_URL = "https://sns.eu-west-3.amazonaws.com/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem";
const TOKEN = "synthetic-confirmation-token";
const SUBSCRIBE_URL = `https://sns.eu-west-3.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(TOPIC)}&Token=${TOKEN}`;

function signed(type = "Notification", overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {
    Type: type, Message: "message with a newline\nand Unicode: é", MessageId: "11111111-2222-4333-8444-555555555555",
    Timestamp: new Date(SIGNED_AT).toISOString(), TopicArn: TOPIC, SigningCertURL: CERT_URL, SignatureVersion: "2",
    ...(type === "Notification" ? {} : { SubscribeURL: SUBSCRIBE_URL, Token: TOKEN }), ...overrides,
  };
  // The signer is an independent wire fixture, with explicit fields and final
  // newline, not a call to the verifier's canonicalization implementation.
  let text = `Message\n${env.Message}\nMessageId\n${env.MessageId}\n`;
  if (type === "Notification") {
    if (Object.hasOwn(env, "Subject")) text += `Subject\n${env.Subject}\n`;
    text += `Timestamp\n${env.Timestamp}\nTopicArn\n${env.TopicArn}\nType\n${env.Type}\n`;
  } else {
    text += `SubscribeURL\n${env.SubscribeURL}\nTimestamp\n${env.Timestamp}\nToken\n${env.Token}\nTopicArn\n${env.TopicArn}\nType\n${env.Type}\n`;
  }
  env.Signature = sign(env.SignatureVersion === "1" ? "RSA-SHA1" : "RSA-SHA256", Buffer.from(text), KEY).toString("base64");
  return env;
}

function verifier(fetcher: SnsFetch = async () => new Response(CERT)) {
  return createSnsVerifier({ fetch: fetcher, now: () => SIGNED_AT + 40 * 24 * 60 * 60 * 1000 });
}

describe("SNS signature and certificate boundary", () => {
  test("unreadable certificate validity fails closed", async () => {
    const envelope = signed();
    const parseDate = Date.parse;
    const parser = spyOn(Date, "parse").mockImplementation((value) =>
      value === certificate.validFrom ? Number.NaN : parseDate(value));
    try {
      await expect(verifier()(envelope, TOPIC)).rejects.toBeInstanceOf(SnsCertificateUnavailableError);
    } finally {
      parser.mockRestore();
    }
  });
  test("v1/v2, optional empty Subject, Unicode and all three envelope types verify", async () => {
    const verify = verifier();
    for (const version of ["1", "2"]) {
      for (const type of ["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"]) {
        const env = signed(type, { SignatureVersion: version });
        expect((await verify(env, TOPIC)).Message).toBe(env.Message!);
      }
      for (const Subject of ["", "subject"]) {
        const env = signed("Notification", { Subject, SignatureVersion: version });
        expect((await verify(env, TOPIC)).Subject).toBe(Subject);
      }
    }
  });

  test("requires configured exact topic and string wire fields before any certificate IO", async () => {
    let fetches = 0;
    const verify = verifier(async () => { fetches++; return new Response(CERT); });
    for (const input of [null, [], {}, { ...signed(), Signature: undefined }, { ...signed(), Message: 42 }, { ...signed(), Subject: null }, { ...signed(), SignatureVersion: "3" }]) {
      await expect(verify(input, TOPIC)).rejects.toBeInstanceOf(InvalidSnsMessageError);
    }
    for (const topic of ["", TOPIC + "-other", "arn:aws-cn:sns:eu-west-3:123456789012:ses-events"]) {
      await expect(verify(signed(), topic)).rejects.toBeInstanceOf(InvalidSnsMessageError);
    }
    expect(fetches).toBe(0);
  });

  test("tampered signed fields are rejected, including absent vs present Subject", async () => {
    const verify = verifier();
    for (const field of ["Message", "MessageId", "Timestamp", "Type", "Subject"]) {
      const env = signed("Notification", { Subject: "original" });
      env[field] = field === "Timestamp" ? new Date(SIGNED_AT + 1).toISOString() : "tampered";
      await expect(verify(env, TOPIC)).rejects.toBeInstanceOf(InvalidSnsMessageError);
    }
    const emptySubject = signed("Notification", { Subject: "" });
    delete emptySubject.Subject;
    await expect(verify(emptySubject, TOPIC)).rejects.toBeInstanceOf(InvalidSnsMessageError);
  });

  test("does not age out delayed deliveries; checks certificate validity at signing time", async () => {
    expect((await verifier()(signed(), TOPIC)).Timestamp).toBe(new Date(SIGNED_AT).toISOString());
    await expect(verifier()(signed("Notification", { Timestamp: new Date(Date.parse(certificate.validTo) + 1000).toISOString() }), TOPIC)).rejects.toBeInstanceOf(InvalidSnsMessageError);
  });

  test("field-separator injection cannot move signed message content into MessageId", async () => {
    const env = signed("Notification", { Message: "{}\nMessageId\nforged-id" });
    env.Message = "{}";
    env.MessageId = `forged-id\nMessageId\n${env.MessageId}`;
    await expect(verifier()(env, TOPIC)).rejects.toBeInstanceOf(InvalidSnsMessageError);
  });

  test("certificate URLs reject arbitrary hosts, redirects, ports and non-certificate paths", async () => {
    let fetches = 0;
    const verify = verifier(async () => { fetches++; return new Response(CERT); });
    for (const url of [
      CERT_URL.replace("https:", "http:"), CERT_URL.replace("eu-west-3", "us-east-1"),
      CERT_URL.replace("amazonaws.com", "amazonaws.com.evil.test"), CERT_URL.replace("https://", "https://user@"),
      CERT_URL.replace("amazonaws.com/", "amazonaws.com:443/"), CERT_URL.replace("amazonaws.com/", "amazonaws.com:8443/"),
      CERT_URL + "?download=1", CERT_URL + "#fragment", CERT_URL.replace("/Simple", "/x/../Simple"),
      "https://127.0.0.1/cert.pem", "https://sns.eu-west-3.amazonaws.com/other.pem",
    ]) await expect(verify(signed("Notification", { SigningCertURL: url }), TOPIC)).rejects.toBeInstanceOf(InvalidSnsMessageError);
    expect(fetches).toBe(0);
    await expect(verifier(async (_url, init) => {
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(null, { status: 302, headers: { location: "https://evil.test/cert.pem" } });
    })(signed(), TOPIC)).rejects.toBeInstanceOf(SnsCertificateUnavailableError);
  });

  test("standard, China, GovCloud and European Sovereign regional endpoints are supported", async () => {
    for (const [partition, region, suffix] of [["aws", "eu-west-3", "amazonaws.com"], ["aws-cn", "cn-north-1", "amazonaws.com.cn"], ["aws-us-gov", "us-gov-west-1", "amazonaws.com"], ["aws-eusc", "eusc-de-east-1", "amazonaws.eu"]]) {
      const topic = `arn:${partition}:sns:${region}:123456789012:ses-events`;
      const certUrl = `https://sns.${region}.${suffix}/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem`;
      expect((await verifier()(signed("Notification", { TopicArn: topic, SigningCertURL: certUrl }), topic)).TopicArn).toBe(topic);
    }
  });

  test("deduplicates certificate loads and snapshots the envelope before awaiting IO", async () => {
    let finish!: (response: Response) => void;
    let fetches = 0;
    const verify = verifier(() => { fetches++; return new Promise((resolve) => { finish = resolve; }); });
    const env = signed();
    const first = verify(env, TOPIC);
    const second = verify(signed(), TOPIC);
    env.Message = "mutation during certificate fetch";
    finish(new Response(CERT));
    expect((await first).Message).not.toBe(env.Message);
    await second;
    await verify(signed(), TOPIC);
    expect(fetches).toBe(1);
  });

  test("failed loads retry, streaming certificates are bounded, and cache entries expire", async () => {
    let fetches = 0;
    const verify = verifier(() => {
      fetches++;
      if (fetches === 1) throw new Error("synthetic network failure");
      return Promise.resolve(new Response(CERT));
    });
    await expect(verify(signed(), TOPIC)).rejects.toBeInstanceOf(SnsCertificateUnavailableError);
    await verify(signed(), TOPIC);
    expect(fetches).toBe(2);
    await expect(verifier(async () => new Response("x".repeat(16_385)))(signed(), TOPIC)).rejects.toBeInstanceOf(SnsCertificateUnavailableError);
    let clock = SIGNED_AT;
    let cachedFetches = 0;
    const cached = createSnsVerifier({ now: () => clock, fetch: async () => { cachedFetches++; return new Response(CERT); } });
    await cached(signed(), TOPIC);
    clock += 60 * 60 * 1000 + 1;
    await cached(signed(), TOPIC);
    expect(cachedFetches).toBe(2);
  });

  test("bounds certificate cache entries and parallel fetches", async () => {
    let fetches = 0;
    const verify = verifier(async () => { fetches++; return new Response(CERT); });
    const withCert = (i: number) => signed("Notification", { SigningCertURL: CERT_URL.replace("0123456789abcdef0123456789abcdef", i.toString(16).padStart(32, "0")) });
    for (let i = 0; i < 33; i++) await verify(withCert(i), TOPIC);
    await verify(withCert(0), TOPIC);
    expect(fetches).toBe(34);
    const releases: Array<(response: Response) => void> = [];
    const limited = verifier(() => new Promise((resolve) => releases.push(resolve)));
    const jobs = Array.from({ length: 8 }, (_, i) => limited(withCert(i), TOPIC));
    await expect(limited(withCert(9), TOPIC)).rejects.toBeInstanceOf(SnsCertificateUnavailableError);
    for (const release of releases) release(new Response(CERT));
    await Promise.all(jobs);
  });
});

describe("verified SNS subscription confirmation", () => {
  test("regional confirmation succeeds with the signed topic/token and redirects disabled", async () => {
    const env = await verifier()(signed("SubscriptionConfirmation"), TOPIC);
    expect(snsSubscriptionUrl(env)).toBe(SUBSCRIBE_URL);
    let fetched = "";
    await confirmSnsSubscription(env, async (url, init) => {
      fetched = url;
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response("<ConfirmSubscriptionResponse />");
    });
    expect(fetched).toBe(SUBSCRIBE_URL);
  });

  test("signed but inconsistent action/topic/token and duplicate parameters are refused", async () => {
    for (const url of [SUBSCRIBE_URL.replace("ConfirmSubscription", "Unsubscribe"), SUBSCRIBE_URL.replace(TOKEN, "other-token"),
      SUBSCRIBE_URL.replace(encodeURIComponent(TOPIC), encodeURIComponent(TOPIC + "-other")),
      SUBSCRIBE_URL + "&Token=duplicate", SUBSCRIBE_URL + "&Action=ConfirmSubscription", SUBSCRIBE_URL + "&TopicArn=" + encodeURIComponent(TOPIC),
      SUBSCRIBE_URL.replace("eu-west-3.amazonaws.com", "us-east-1.amazonaws.com"), SUBSCRIBE_URL.replace("https:", "http:"),
      SUBSCRIBE_URL.replace("amazonaws.com/", "amazonaws.com:443/"), SUBSCRIBE_URL + "#ignored",
    ]) await expect(verifier()(signed("SubscriptionConfirmation", { SubscribeURL: url }), TOPIC)).rejects.toBeInstanceOf(InvalidSnsMessageError);
  });
});

describe("SES route authenticates before processing", () => {
  function route(options: { expectedArn?: string; enabled?: boolean; certFetch?: SnsFetch } = {}) {
    // rights R4a — `actions` is the union of both seams, IN ORDER, so every
    // assertion below keeps its meaning; `acquisitionActions` additionally
    // records which of them happened under the ACQUISITION realm rather than
    // under a product grant. The integration lookup moved seams in R4a C1a
    // (it is discovery — it reads the row the verification is about to use)
    // and this is what makes that visible rather than silent.
    const actions: string[] = [];
    const acquisitionActions: string[] = [];
    const confirmations: string[] = [];
    const answer = (action: string, args: Record<string, unknown>) => {
      if (action === "state.find_integration_by_id_and_type") return { $tag: "Just", _0: { id: "integration", accountId: "account", enabled: options.enabled ?? true, credentials: { SES_SNS_TOPIC_ARN: options.expectedArn ?? TOPIC } } };
      if (action === "emailWebhooks:sesEvents") return { $tag: "ConfirmSubscription", url: (args.subscribeUrl as { _0: string })._0 };
      throw new Error("unexpected side effect");
    };
    const app = createSesWebhookRoutes({
      invoke: async (_account, _profile, action, args) => {
        actions.push(action);
        return answer(action, args);
      },
      acquire: async (_authority, _partition, _profile, action, args) => {
        actions.push(action);
        acquisitionActions.push(action);
        return answer(action, args);
      },
      verify: verifier(options.certFetch),
      confirm: (env) => confirmSnsSubscription(env, async (url) => { confirmations.push(url); return new Response("confirmed"); }),
    });
    const send = (env: unknown) => app.request("http://local/integration/events", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(env) });
    return { actions, acquisitionActions, confirmations, send };
  }

  test("unsigned, tampered, missing-topic and disabled messages never reach ingress or confirmation", async () => {
    for (const body of [null, [], { ...signed(), Signature: undefined }, { ...signed(), Message: "{}" }, { ...signed("SubscriptionConfirmation"), Token: "changed" }]) {
      const fixture = route();
      expect((await fixture.send(body)).status).toBe(403);
      expect(fixture.actions).toEqual(["state.find_integration_by_id_and_type"]);
      // rights R4a — and it happened under ACQUISITION, not under a product
      // grant. Before C1a this lookup minted a `""`-account member envelope and
      // read integration CREDENTIALS under it.
      expect(fixture.acquisitionActions).toEqual(["state.find_integration_by_id_and_type"]);
      expect(fixture.confirmations).toEqual([]);
    }
    for (const config of [{ expectedArn: "" }, { enabled: false }]) {
      const fixture = route(config);
      expect((await fixture.send(signed())).status).toBe(403);
      expect(fixture.actions).toHaveLength(1);
    }
    // rights R2a — the authority mint warms the execution registry on the
    // first call in a process. The build is memoised and the API server pays
    // it at boot in production; here it lands inside the 5s default.
  }, 300_000);

  test("certificate transport failure is retryable, not an unsigned-message refusal", async () => {
    const fixture = route({ certFetch: async () => { throw new DOMException("synthetic timeout", "TimeoutError"); } });
    expect((await fixture.send(signed())).status).toBe(503);
    expect(fixture.actions).toHaveLength(1);
    expect(fixture.confirmations).toHaveLength(0);
  });

  test("valid regional confirmation reaches the existing Fenel decision and one confirmation GET", async () => {
    const fixture = route();
    const response = await fixture.send(signed("SubscriptionConfirmation"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, confirmed: true });
    expect(fixture.actions).toEqual(["state.find_integration_by_id_and_type", "emailWebhooks:sesEvents"]);
    // The discovery half is acquisition; the product effect is NOT.
    expect(fixture.acquisitionActions).toEqual(["state.find_integration_by_id_and_type"]);
    expect(fixture.confirmations).toEqual([SUBSCRIBE_URL]);
  });

  test("signed null/array SES payloads fail before mapper or event dispatch", async () => {
    for (const Message of ["null", "[]", "42"]) {
      const fixture = route();
      expect((await fixture.send(signed("Notification", { Message }))).status).toBe(400);
      expect(fixture.actions).toHaveLength(1);
    }
  });
});
