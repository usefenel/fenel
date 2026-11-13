import { eq, and } from "drizzle-orm";
import { getDb } from "@fenel/db";
import { integrations } from "@fenel/db/schema";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { IntegrationType } from "@fenel/engine/integrations";
import type { AIResponse, AIError, Reasoning, FenelType } from "@fenel/engine/types";
import { Just } from "@fenel/engine/type-foundation";
import { fenelTypeToJsonSchema } from "@fenel/engine/json-schema";
import {
  mailgunSend,
  mailgunSendBatch,
  mailgunSuppress,
  mailgunAddDomain,
  mailgunVerifyDomain,
  mailgunListDomains,
} from "./providers/mailgun";
import {
  postmarkSend,
  postmarkSendBatch,
  postmarkSuppress,
  postmarkAddDomain,
  postmarkVerifyDomain,
  postmarkListDomains,
} from "./providers/postmark";
import {
  fenelSend,
  fenelSendBatch,
  fenelSuppress,
  fenelAddDomain,
  fenelVerifyDomain,
  fenelListDomains,
} from "./providers/fenel";
import {
  sesSend,
  sesSendBatch,
  sesSuppress,
  sesAddDomain,
  sesVerifyDomain,
  sesListDomains,
} from "./providers/ses";
import {
  resendSend,
  resendSendBatch,
  resendSuppress,
  resendAddDomain,
  resendVerifyDomain,
  resendListDomains,
} from "./providers/resend";
import type { EmailValue, SendResultValue } from "./providers/mailgun";

type Credentials = Record<string, string>;

async function getCredentials(accountId: string, type: IntegrationType): Promise<Credentials | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.accountId, accountId), eq(integrations.type, type), eq(integrations.enabled, true)))
    .limit(1);
  return row?.credentials as Credentials | null;
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

async function stripeCreateCheckout(params: Record<string, unknown>, creds: Credentials): Promise<unknown> {
  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${creds.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "mode": "payment",
      "line_items[0][price_data][currency]": String(params.currency ?? "usd"),
      "line_items[0][price_data][unit_amount]": String(params.amount),
      "line_items[0][price_data][product_data][name]": String(params.plan ?? "Payment"),
      "line_items[0][quantity]": "1",
      ...(params.success_url ? { "success_url": String(params.success_url) } : {}),
      ...(params.cancel_url ? { "cancel_url": String(params.cancel_url) } : {}),
    }),
  });
  return resp.json();
}

async function stripeVerify(params: Record<string, unknown>, creds: Credentials): Promise<unknown> {
  const resp = await fetch(`https://api.stripe.com/v1/payment_intents/${params.payment_id}`, {
    headers: { "Authorization": `Bearer ${creds.STRIPE_SECRET_KEY}` },
  });
  return resp.json();
}

async function stripeRefund(params: Record<string, unknown>, creds: Credentials): Promise<unknown> {
  const body: Record<string, string> = { payment_intent: String(params.payment_id) };
  if (params.amount) body.amount = String(params.amount);
  const resp = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${creds.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  return resp.json();
}

// ---------------------------------------------------------------------------
// NOWPayments
// ---------------------------------------------------------------------------

async function nowpaymentsCreateCheckout(params: Record<string, unknown>, creds: Credentials): Promise<unknown> {
  const resp = await fetch("https://api.nowpayments.io/v1/payment", {
    method: "POST",
    headers: {
      "x-api-key": creds.NOWPAYMENTS_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      price_amount: params.amount,
      price_currency: "usd",
      pay_currency: params.currency,
    }),
  });
  return resp.json();
}

async function nowpaymentsVerify(params: Record<string, unknown>, creds: Credentials): Promise<unknown> {
  const resp = await fetch(`https://api.nowpayments.io/v1/payment/${params.payment_id}`, {
    headers: { "x-api-key": creds.NOWPAYMENTS_API_KEY! },
  });
  return resp.json();
}


// ---------------------------------------------------------------------------
// AI — Anthropic
// ---------------------------------------------------------------------------

async function anthropicComplete(params: Record<string, unknown>, creds: Credentials): Promise<unknown> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": creds.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model ?? "claude-sonnet-4-6",
      max_tokens: params.max_tokens ?? 1024,
      temperature: params.temperature ?? 0.7,
      messages: [{ role: "user", content: String(params.prompt) }],
    }),
  });
  const data = await resp.json() as Record<string, unknown>;
  const content = (data.content as { text: string }[])?.[0]?.text;
  return content ?? data;
}

// ---------------------------------------------------------------------------
// AI — OpenAI
// ---------------------------------------------------------------------------

async function openaiComplete(params: Record<string, unknown>, creds: Credentials): Promise<unknown> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${creds.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model ?? "gpt-4o",
      max_tokens: params.max_tokens ?? 1024,
      temperature: params.temperature ?? 0.7,
      messages: [{ role: "user", content: String(params.prompt) }],
    }),
  });
  const data = await resp.json() as Record<string, unknown>;
  const choices = data.choices as { message: { content: string } }[];
  return choices?.[0]?.message?.content ?? data;
}

// ---------------------------------------------------------------------------
// Twitter / X — cookie-based auth, fxtwitter for public metrics
// ---------------------------------------------------------------------------

const TWITTER_GRAPHQL = "https://x.com/i/api/graphql";
const TWITTER_BEARER = process.env["TWITTER_BEARER_TOKEN"] ?? "";

function twitterHeaders(creds: Credentials): Record<string, string> {
  return {
    "Authorization": `Bearer ${TWITTER_BEARER}`,
    "Cookie": `ct0=${creds.ct0 ?? ""}; auth_token=${creds.authToken ?? ""}`,
    "X-Csrf-Token": creds.ct0 ?? "",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "X-Twitter-Active-User": "yes",
    "X-Twitter-Auth-Type": "OAuth2Session",
  };
}

async function twitterGetMetrics(params: Record<string, unknown>): Promise<unknown> {
  const input = String(params.tweet_url ?? params.tweet_id ?? "");
  const tweetId = input.includes("/") ? input.split("/").pop()!.split("?")[0] : input;
  const resp = await fetch(`https://api.fxtwitter.com/x/status/${tweetId}`);
  if (!resp.ok) throw new Error(`fxtwitter ${resp.status}`);
  const data = await resp.json() as any;
  const t = data.tweet;
  if (!t) throw new Error("Tweet not found");
  return {
    id: t.id,
    text: t.text,
    likes: t.likes ?? 0,
    retweets: t.retweets ?? 0,
    replies: t.replies ?? 0,
    quotes: t.quotes ?? 0,
    views: t.views ?? 0,
    bookmarks: t.bookmarks ?? 0,
    author: t.author?.screen_name ?? null,
    createdAt: t.created_at ?? null,
    createdTimestamp: t.created_timestamp ?? null,
  };
}

async function twitterGetRecent(params: Record<string, unknown>, creds: Credentials): Promise<unknown> {
  const username = String(params.username);
  const count = (params.count as number) ?? 10;

  const userResp = await fetch(
    `${TWITTER_GRAPHQL}/xc8f1g7BYqr6VTzTbvNlGw/UserByScreenName?variables=${encodeURIComponent(JSON.stringify({ screen_name: username }))}`,
    { headers: twitterHeaders(creds) },
  );
  if (!userResp.ok) throw new Error(`Twitter user lookup ${userResp.status}`);
  const userData = await userResp.json() as any;
  const userId = userData?.data?.user?.result?.rest_id;
  if (!userId) throw new Error(`User @${username} not found`);

  const variables = {
    userId,
    count,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: false,
    withV2Timeline: true,
  };
  const features = {
    profile_label_improvements_pcf_label_in_post_enabled: false,
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  };
  const timelineResp = await fetch(
    `${TWITTER_GRAPHQL}/V7H0Ap3_Hh2FyS75OCDO3Q/UserTweets?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`,
    { headers: twitterHeaders(creds) },
  );
  if (!timelineResp.ok) throw new Error(`Twitter timeline ${timelineResp.status}`);
  const timeline = await timelineResp.json() as any;

  const entries = timeline?.data?.user?.result?.timeline_v2?.timeline?.instructions
    ?.find((i: any) => i.type === "TimelineAddEntries")?.entries ?? [];

  const tweets: unknown[] = [];
  for (const entry of entries) {
    const result = entry?.content?.itemContent?.tweet_results?.result;
    if (!result?.legacy) continue;
    const leg = result.legacy;
    tweets.push({
      id: leg.id_str ?? result.rest_id,
      text: leg.full_text,
      likes: leg.favorite_count ?? 0,
      retweets: leg.retweet_count ?? 0,
      replies: leg.reply_count ?? 0,
      quotes: leg.quote_count ?? 0,
      views: parseInt(result?.views?.count ?? "0"),
      createdAt: leg.created_at,
      isReply: !!leg.in_reply_to_status_id_str,
      isRetweet: !!leg.retweeted_status_result,
    });
  }
  return tweets.slice(0, count);
}

async function twitterPostReply(params: Record<string, unknown>, creds: Credentials): Promise<unknown> {
  const tweetId = String(params.tweet_id);
  const text = String(params.text);

  const variables = {
    tweet_text: text,
    reply: { in_reply_to_tweet_id: tweetId, exclude_reply_user_ids: [] },
    dark_request: false,
    media: { media_entities: [], possibly_sensitive: false },
    semantic_annotation_ids: [],
  };
  const resp = await fetch(`${TWITTER_GRAPHQL}/a1p9RWpkYKBjWv_I3WzS-A/CreateTweet`, {
    method: "POST",
    headers: twitterHeaders(creds),
    body: JSON.stringify({
      variables,
      features: {
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        rweb_video_timestamps_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_enhance_cards_enabled: false,
      },
      queryId: "a1p9RWpkYKBjWv_I3WzS-A",
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Twitter post failed ${resp.status}: ${body}`);
  }
  const data = await resp.json() as any;
  const created = data?.data?.create_tweet?.tweet_results?.result;
  return {
    id: created?.rest_id ?? null,
    text: created?.legacy?.full_text ?? text,
    ok: !!created,
  };
}

// ---------------------------------------------------------------------------
// Provider dispatch map
// ---------------------------------------------------------------------------

type ProviderFn = (params: Record<string, unknown>, creds: Credentials) => Promise<unknown>;

const PROVIDER_IMPLS: Record<string, Record<string, ProviderFn>> = {
  "Payment.stripe": {
    create_checkout: stripeCreateCheckout,
    verify: stripeVerify,
    refund: stripeRefund,
  },
  "Payment.nowpayments": {
    create_checkout: nowpaymentsCreateCheckout,
    verify: nowpaymentsVerify,
  },
  "EmailService.mailgun": {
    send: mailgunSend as ProviderFn,
    send_batch: mailgunSendBatch as ProviderFn,
    suppress: mailgunSuppress as ProviderFn,
    domainAdd:mailgunAddDomain as ProviderFn,
    domainVerify:mailgunVerifyDomain as ProviderFn,
    domainList:mailgunListDomains as ProviderFn,
  },
  "EmailService.postmark": {
    send: postmarkSend as ProviderFn,
    send_batch: postmarkSendBatch as ProviderFn,
    suppress: postmarkSuppress as ProviderFn,
    domainAdd:postmarkAddDomain as ProviderFn,
    domainVerify:postmarkVerifyDomain as ProviderFn,
    domainList:postmarkListDomains as ProviderFn,
  },
  "EmailService.fenel": {
    send: fenelSend as ProviderFn,
    send_batch: fenelSendBatch as ProviderFn,
    suppress: fenelSuppress as ProviderFn,
    domainAdd:fenelAddDomain as ProviderFn,
    domainVerify:fenelVerifyDomain as ProviderFn,
    domainList:fenelListDomains as ProviderFn,
  },
  "EmailService.ses": {
    send: sesSend as ProviderFn,
    send_batch: sesSendBatch as ProviderFn,
    suppress: sesSuppress as ProviderFn,
    domainAdd:sesAddDomain as ProviderFn,
    domainVerify:sesVerifyDomain as ProviderFn,
    domainList:sesListDomains as ProviderFn,
  },
  "EmailService.resend": {
    send: resendSend as ProviderFn,
    send_batch: resendSendBatch as ProviderFn,
    suppress: resendSuppress as ProviderFn,
    domainAdd:resendAddDomain as ProviderFn,
    domainVerify:resendVerifyDomain as ProviderFn,
    domainList:resendListDomains as ProviderFn,
  },
  "AI.anthropic": {
    complete: anthropicComplete,
  },
  "AI.openai": {
    complete: openaiComplete,
  },
};

// ---------------------------------------------------------------------------
// Register provider IO handlers
// ---------------------------------------------------------------------------

/** Providers whose handlers source their credentials from server-level
 *  env vars (not per-account integrations). The dispatcher skips
 *  getCredentials for these and instead injects `__ACCOUNT_ID` into the
 *  passed creds map so the handler can scope its work per tenant.
 *  - "fenel": managed-default email pseudo-provider */
const NO_CREDS_PROVIDERS = new Set(["fenel"]);

export function registerProviderHandlers(reg: ModuleRegistry): void {
  for (const cap of reg.listCapabilities()) {
    for (const method of cap.methods) {
      const qualName = `${cap.name}.${method.name}`;
      reg.registerIOHandler(qualName, async (params, ctx) => {
        const resolved = reg.resolveCapabilityMethod(qualName);
        if (!resolved) throw new Error(`No provider for ${qualName}`);

        const providerName = resolved.provider.args[0] as string;
        const providerKey = `${cap.name}.${providerName}`;
        const impl = PROVIDER_IMPLS[providerKey]?.[method.name];

        if (impl) {
          let creds: Credentials;
          if (NO_CREDS_PROVIDERS.has(providerName)) {
            creds = { __ACCOUNT_ID: ctx.accountId };
          } else {
            const fetched = await getCredentials(ctx.accountId, providerName as IntegrationType);
            if (!fetched) throw new Error(`No credentials for ${providerName} (account ${ctx.accountId})`);
            creds = fetched;
          }
          const result = await impl(params, creds);
          return { action: "continue" as const, value: result };
        }

        return { action: "continue" as const, value: await ctx.dispatchAction(qualName, params) };
      });
    }
  }

  // --- send_email provider-send leaf (action-subsumption Phase N) ---
  //
  // The irreducible per-provider HTTP send for `email:providerSend`. The
  // Fenel body (email.fenel `sendEmail`) does the per-account provider
  // SELECTION (pickProvider over state:listIntegrations) — pure logic that
  // moved out of the retired email-action.ts `dispatchEmailSend` chain — and
  // passes the chosen provider name here. This leaf re-fetches that provider's
  // enabled integration credentials and calls the existing provider impl;
  // "fenel" is the managed default (master env creds, no per-account lookup).
  // Credentials never cross into Fenel/traces — only the provider name does. A
  // thrown provider error is returned as a typed Rejected SendResult rather
  // than escaping, so the body's `emailResultToAction` maps it uniformly.
  reg.registerIOHandler("email.provider_send", async (params, ctx) => {
    const provider = String(params["provider"] ?? "fenel");
    const email = params["email"] as EmailValue;
    const PROVIDER_SEND: Record<string, (p: Record<string, unknown>, c: Credentials) => Promise<SendResultValue>> = {
      mailgun: mailgunSend,
      postmark: postmarkSend,
      ses: sesSend,
      resend: resendSend,
    };
    let result: SendResultValue;
    try {
      if (provider === "fenel") {
        result = await fenelSend({ email }, { __ACCOUNT_ID: ctx.accountId });
      } else {
        const send = PROVIDER_SEND[provider];
        const creds = send ? await getCredentials(ctx.accountId, provider as IntegrationType) : null;
        result = send && creds
          ? await send({ email }, creds)
          : await fenelSend({ email }, { __ACCOUNT_ID: ctx.accountId });
      }
    } catch (err) {
      result = {
        $tag: "Rejected",
        reason: { $tag: "ProviderError", code: "send", message: String((err as Error)?.message ?? err) },
      };
    }
    return { action: "continue" as const, value: result };
  });

  // --- Twitter standalone handlers ---

  reg.registerIOHandler("twitter_get_metrics", async (params) => {
    const result = await twitterGetMetrics(params);
    return { action: "continue" as const, value: result };
  });

  reg.registerIOHandler("twitter_get_recent", async (params, ctx) => {
    const creds = await getCredentials(ctx.accountId, "twitter");
    if (!creds) throw new Error("No Twitter credentials configured");
    const result = await twitterGetRecent(params, creds);
    return { action: "continue" as const, value: result };
  });

  reg.registerIOHandler("twitter_post_reply", async (params, ctx) => {
    const creds = await getCredentials(ctx.accountId, "twitter");
    if (!creds) throw new Error("No Twitter credentials configured");
    const result = await twitterPostReply(params, creds);
    return { action: "continue" as const, value: result };
  });

  // --- callLLM — unified AI handler ---

  reg.registerIOHandler("callLLM", async (params, ctx) => {
    const prompt = String(params.prompt ?? "");
    const system = params.system ? String(params.system) : undefined;
    const outputSchema = params.outputSchema as FenelType | undefined;
    const temperature = params.temperature as number | undefined;
    const maxTokens = params.maxTokens as number | undefined;
    const reasoning = params.reasoning as Reasoning | undefined;

    const anthropicCreds = await getCredentials(ctx.accountId, "anthropic" as IntegrationType);
    const openaiCreds = !anthropicCreds ? await getCredentials(ctx.accountId, "openai" as IntegrationType) : null;

    if (!anthropicCreds && !openaiCreds) {
      const error: AIError = { $tag: "AuthError", message: "No AI provider credentials configured (anthropic or openai)" };
      return { action: "continue" as const, value: { $tag: "Err", _0: error } };
    }

    const jsonSchema = outputSchema ? fenelTypeToJsonSchema(outputSchema) : undefined;

    try {
      let text: string;

      if (anthropicCreds) {
        text = await callAnthropic(prompt, system, jsonSchema, anthropicCreds, { temperature, maxTokens, reasoning });
      } else {
        text = await callOpenAI(prompt, system, jsonSchema, openaiCreds!, { temperature, maxTokens, reasoning });
      }

      if (jsonSchema) {
        try {
          const parsed = JSON.parse(text);
          const response: AIResponse = { $tag: "Parsed", value: parsed };
          return { action: "continue" as const, value: { $tag: "Ok", _0: response } };
        } catch {
          const response: AIResponse = { $tag: "Raw", text };
          return { action: "continue" as const, value: { $tag: "Ok", _0: response } };
        }
      }

      const response: AIResponse = { $tag: "Raw", text };
      return { action: "continue" as const, value: { $tag: "Ok", _0: response } };

    } catch (err) {
      const error = classifyError(err);
      return { action: "continue" as const, value: { $tag: "Err", _0: error } };
    }
  });
}

// ---------------------------------------------------------------------------
// LLM provider implementations
// ---------------------------------------------------------------------------

type LLMOpts = {
  temperature?: number;
  maxTokens?: number;
  reasoning?: Reasoning;
};

async function callAnthropic(
  prompt: string,
  system: string | undefined,
  jsonSchema: unknown | undefined,
  creds: Credentials,
  opts: LLMOpts,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: "claude-sonnet-4-20250514",
    max_tokens: opts.maxTokens ?? 4096,
    messages: [{ role: "user", content: prompt }],
  };

  if (system) body.system = system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  if (opts.reasoning) {
    if (opts.reasoning.$tag === "Budget") {
      body.thinking = { type: "enabled", budget_tokens: opts.reasoning.budget };
      delete body.temperature;
    } else if (opts.reasoning.$tag === "Effort") {
      const budgetMap = { low: 2000, medium: 10000, high: 50000 };
      body.thinking = { type: "enabled", budget_tokens: budgetMap[opts.reasoning.level] };
      delete body.temperature;
    } else if (opts.reasoning.$tag === "Auto") {
      body.thinking = { type: "enabled", budget_tokens: 10000 };
      delete body.temperature;
    }
  }

  if (jsonSchema) {
    body.messages = [{
      role: "user",
      content: prompt + "\n\nRespond with valid JSON matching this schema:\n" + JSON.stringify(jsonSchema),
    }];
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": creds.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    if (resp.status === 429) throw { kind: "rate_limit", retryAfter: parseInt(resp.headers.get("retry-after") ?? "60") };
    if (resp.status === 401) throw { kind: "auth", message: errBody };
    throw new Error(`Anthropic ${resp.status}: ${errBody}`);
  }

  const data = await resp.json() as Record<string, unknown>;
  const content = data.content as { type: string; text?: string }[];
  const textBlock = content?.find(b => b.type === "text");
  return textBlock?.text ?? JSON.stringify(data);
}

async function callOpenAI(
  prompt: string,
  system: string | undefined,
  jsonSchema: unknown | undefined,
  creds: Credentials,
  opts: LLMOpts,
): Promise<string> {
  const messages: { role: string; content: string }[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const body: Record<string, unknown> = {
    model: "gpt-4o",
    max_tokens: opts.maxTokens ?? 4096,
    messages,
  };

  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  if (opts.reasoning) {
    if (opts.reasoning.$tag === "Effort") {
      body.model = "o3";
      body.reasoning_effort = opts.reasoning.level;
      delete body.temperature;
    } else if (opts.reasoning.$tag === "Budget" || opts.reasoning.$tag === "Auto") {
      body.model = "o3";
      body.reasoning_effort = "medium";
      delete body.temperature;
    }
  }

  if (jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "output", strict: true, schema: jsonSchema },
    };
  }

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${creds.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    if (resp.status === 429) throw { kind: "rate_limit", retryAfter: parseInt(resp.headers.get("retry-after") ?? "60") };
    if (resp.status === 401) throw { kind: "auth", message: errBody };
    throw new Error(`OpenAI ${resp.status}: ${errBody}`);
  }

  const data = await resp.json() as Record<string, unknown>;
  const choices = data.choices as { message: { content: string } }[];
  return choices?.[0]?.message?.content ?? JSON.stringify(data);
}

function classifyError(err: unknown): AIError {
  if (err && typeof err === "object" && "kind" in err) {
    const e = err as Record<string, unknown>;
    if (e.kind === "rate_limit") return { $tag: "RateLimit", retryAfter: Just(e.retryAfter as number) };
    if (e.kind === "auth") return { $tag: "AuthError", message: String(e.message) };
  }
  return { $tag: "NetworkError", message: String(err) };
}
