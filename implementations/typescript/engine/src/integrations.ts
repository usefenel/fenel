// ---------------------------------------------------------------------------
// Integration type definitions — credential shapes per service
//
// Lives in @fenel/engine (zero-dep) so both frontend and backend can use.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Credential shapes — what each integration stores
// ---------------------------------------------------------------------------

export type StripeCredentials = {
  secretKey: string;
  webhookSecret?: string;
  /** "test" | "live" — inferred from key prefix */
  mode?: "test" | "live";
};

export type NowPaymentsCredentials = {
  apiKey: string;
  ipnSecret?: string;
};

export type CalendlyCredentials = {
  token: string;
  webhookUrl?: string;
};

export type TelegramBotCredentials = {
  botToken: string;
};

export type WebhookCredentials = {
  url: string;
  secret?: string;
  /** HTTP method — default POST */
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
};

export type EmailSmtpCredentials = {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  tls?: boolean;
};

export type TwitterCredentials = {
  /** CSRF token cookie (ct0) */
  ct0: string;
  /** Session cookie (auth_token) */
  authToken: string;
  /** Username for reference */
  username: string;
};

type AnthropicCredentials = {
  ANTHROPIC_API_KEY: string;
};

type OpenAICredentials = {
  OPENAI_API_KEY: string;
};

export type MailgunCredentials = {
  MAILGUN_API_KEY: string;
  /** "us" (api.mailgun.net) or "eu" (api.eu.mailgun.net). Defaults to "us". */
  MAILGUN_REGION?: "us" | "eu";
  /** Default sender domain for outbound when an Email's `from.domain` isn't
   *  one of the verified domains. Optional. */
  MAILGUN_DOMAIN?: string;
  /** HMAC signing key used to verify inbound + event webhooks. Optional —
   *  only needed if this account receives webhook events. */
  MAILGUN_WEBHOOK_SIGNING_KEY?: string;
};

export type PostmarkCredentials = {
  POSTMARK_SERVER_TOKEN: string;
  /** Account-level token, only required for domain management. */
  POSTMARK_ACCOUNT_TOKEN?: string;
};

export type SESCredentials = {
  AWS_REGION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  /** SNS topic ARN that SES publishes events to. Required if this
   *  account receives lifecycle webhooks via SNS HTTP-subscription. */
  SES_SNS_TOPIC_ARN?: string;
};

export type ResendCredentials = {
  RESEND_API_KEY: string;
  /** Svix-style `whsec_…` signing secret used to verify webhook
   *  payloads. Optional — only required if this account receives
   *  Resend webhook events. */
  RESEND_WEBHOOK_SIGNING_SECRET?: string;
};

// ---------------------------------------------------------------------------
// Discriminated union — integration type → credential shape
// ---------------------------------------------------------------------------

export type IntegrationTypeMap = {
  stripe: StripeCredentials;
  nowpayments: NowPaymentsCredentials;
  calendly: CalendlyCredentials;
  telegram_bot: TelegramBotCredentials;
  webhook: WebhookCredentials;
  email_smtp: EmailSmtpCredentials;
  twitter: TwitterCredentials;
  anthropic: AnthropicCredentials;
  openai: OpenAICredentials;
  mailgun: MailgunCredentials;
  postmark: PostmarkCredentials;
  ses: SESCredentials;
  resend: ResendCredentials;
};

export type IntegrationType = keyof IntegrationTypeMap;

export type Integration<T extends IntegrationType = IntegrationType> = {
  id: string;
  accountId: string;
  type: T;
  label?: string;
  credentials: IntegrationTypeMap[T];
  config: Record<string, unknown>;
  status: "active" | "failing" | "expired" | "disabled";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Known services — UI metadata
// ---------------------------------------------------------------------------

export type ServiceInfo = {
  type: IntegrationType;
  label: string;
  description: string;
  /** Fields needed in credentials — drives the form */
  credentialFields: { key: string; label: string; secret?: boolean }[];
};

export const KNOWN_SERVICES: ServiceInfo[] = [
  {
    type: "stripe",
    label: "Stripe",
    description: "Payment processing",
    credentialFields: [
      { key: "secretKey", label: "Secret Key", secret: true },
      { key: "webhookSecret", label: "Webhook Secret", secret: true },
    ],
  },
  {
    type: "nowpayments",
    label: "NOWPayments",
    description: "Crypto payments",
    credentialFields: [
      { key: "apiKey", label: "API Key", secret: true },
      { key: "ipnSecret", label: "IPN Secret", secret: true },
    ],
  },
  {
    type: "calendly",
    label: "Calendly",
    description: "Call scheduling",
    credentialFields: [
      { key: "token", label: "Personal Access Token", secret: true },
      { key: "webhookUrl", label: "Webhook URL" },
    ],
  },
  {
    type: "telegram_bot",
    label: "Telegram Bot",
    description: "Bot messaging",
    credentialFields: [
      { key: "botToken", label: "Bot Token", secret: true },
    ],
  },
  {
    type: "webhook",
    label: "Webhook",
    description: "HTTP callback",
    credentialFields: [
      { key: "url", label: "URL" },
      { key: "secret", label: "Signing Secret", secret: true },
    ],
  },
  {
    type: "email_smtp",
    label: "Email (SMTP)",
    description: "Transactional email",
    credentialFields: [
      { key: "host", label: "SMTP Host" },
      { key: "port", label: "Port" },
      { key: "username", label: "Username" },
      { key: "password", label: "Password", secret: true },
      { key: "from", label: "From Address" },
    ],
  },
  {
    type: "twitter",
    label: "Twitter / X",
    description: "Viral tweet monitoring and auto-replies",
    credentialFields: [
      { key: "username", label: "Username" },
      { key: "ct0", label: "ct0 Cookie", secret: true },
      { key: "authToken", label: "auth_token Cookie", secret: true },
    ],
  },
  {
    type: "mailgun",
    label: "Mailgun",
    description: "Transactional + marketing email with parsed inbound (Routes)",
    credentialFields: [
      { key: "MAILGUN_API_KEY", label: "API Key", secret: true },
      { key: "MAILGUN_REGION", label: "Region (us | eu)" },
      { key: "MAILGUN_DOMAIN", label: "Default sending domain" },
      { key: "MAILGUN_WEBHOOK_SIGNING_KEY", label: "Webhook signing key", secret: true },
    ],
  },
  {
    type: "postmark",
    label: "Postmark",
    description: "Best-in-class transactional email with parsed inbound",
    credentialFields: [
      { key: "POSTMARK_SERVER_TOKEN", label: "Server Token", secret: true },
      { key: "POSTMARK_ACCOUNT_TOKEN", label: "Account Token (for domains)", secret: true },
    ],
  },
  {
    type: "ses",
    label: "AWS SES",
    description: "Cheap email at scale (SESv2)",
    credentialFields: [
      { key: "AWS_REGION", label: "Region (e.g. us-east-1)" },
      { key: "AWS_ACCESS_KEY_ID", label: "Access Key ID", secret: true },
      { key: "AWS_SECRET_ACCESS_KEY", label: "Secret Access Key", secret: true },
      { key: "SES_SNS_TOPIC_ARN", label: "SNS Topic ARN (for lifecycle webhooks)" },
    ],
  },
  {
    type: "resend",
    label: "Resend",
    description: "Modern API-first transactional email",
    credentialFields: [
      { key: "RESEND_API_KEY", label: "API Key", secret: true },
      { key: "RESEND_WEBHOOK_SIGNING_SECRET", label: "Webhook signing secret (whsec_…)", secret: true },
    ],
  },
];
