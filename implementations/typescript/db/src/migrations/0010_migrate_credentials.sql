-- Migrate credentials from accounts.config → integrations table
-- Run AFTER 0010_integrations.sql
-- Idempotent: uses ON CONFLICT DO NOTHING

-- Stripe
INSERT INTO integrations (account_id, type, credentials, config)
SELECT
  id,
  'stripe',
  jsonb_build_object(
    'secretKey', config->>'stripe_secret_key',
    'webhookSecret', config->>'stripe_webhook_secret'
  ),
  '{}'::jsonb
FROM accounts
WHERE config->>'stripe_secret_key' IS NOT NULL
ON CONFLICT (account_id, type) DO NOTHING;

-- NOWPayments
INSERT INTO integrations (account_id, type, credentials, config)
SELECT
  id,
  'nowpayments',
  jsonb_build_object('apiKey', config->>'nowpayments_api_key'),
  '{}'::jsonb
FROM accounts
WHERE config->>'nowpayments_api_key' IS NOT NULL
ON CONFLICT (account_id, type) DO NOTHING;

-- Calendly
INSERT INTO integrations (account_id, type, credentials, config)
SELECT
  id,
  'calendly',
  jsonb_build_object(
    'token', config->>'calendly_token',
    'webhookUrl', config->>'calendly_webhook_url'
  ),
  '{}'::jsonb
FROM accounts
WHERE config->>'calendly_token' IS NOT NULL
ON CONFLICT (account_id, type) DO NOTHING;
