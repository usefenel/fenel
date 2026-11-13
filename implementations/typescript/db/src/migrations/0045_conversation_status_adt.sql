-- 0045: Phase 11c sub-step 2b — ConversationStatus ADT lift.
--
-- Migrates Conversation.status JSONB field from a string-keyed refined-enum
-- ("active" | "confirming" | "completed" | "cancelled") to the typed
-- ConversationStatus ADT (Active | Confirming | Completed | Cancelled),
-- stored as the canonical Fenel nullary tagged-variant shape
-- ({"$tag": "Active"} etc. — same shape produced by `{construct: ["Active"]}`
-- in JSON Logic, matching how every other nullary tagged variant is
-- stored in entity_instances).
--
-- Idempotent — the WHERE clause keys on the legacy string shape, so
-- re-running is a no-op (rows already migrated have a jsonb-object
-- status, and `data->>'status'` extracts NULL for jsonb objects, which
-- doesn't match any of the legacy string predicates).
--
-- Touches only entity_instances rows of entity_type = 'Conversation'.
-- The dead `conversations` table (from 006_conversations.sql) is out of
-- scope for this migration and may be dropped in 11c-4 cleanup.

UPDATE entity_instances
SET data = jsonb_set(data, '{status}', '{"$tag": "Active"}'::jsonb)
WHERE entity_type = 'Conversation' AND data->>'status' = 'active';

UPDATE entity_instances
SET data = jsonb_set(data, '{status}', '{"$tag": "Confirming"}'::jsonb)
WHERE entity_type = 'Conversation' AND data->>'status' = 'confirming';

UPDATE entity_instances
SET data = jsonb_set(data, '{status}', '{"$tag": "Completed"}'::jsonb)
WHERE entity_type = 'Conversation' AND data->>'status' = 'completed';

UPDATE entity_instances
SET data = jsonb_set(data, '{status}', '{"$tag": "Cancelled"}'::jsonb)
WHERE entity_type = 'Conversation' AND data->>'status' = 'cancelled';
