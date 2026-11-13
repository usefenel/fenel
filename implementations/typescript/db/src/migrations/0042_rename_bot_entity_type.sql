-- 0042: rename the Telegram bot system-entity from lowercase "bot" to
-- PascalCase "Bot" — aligns with Fenel's "Uppercase = type / constructor,
-- lowercase = function" convention so `Bot { … }` in Fenel source parses
-- as a real constructor through `parseApp`'s uppercase-head branch. Same
-- physical entity, just renamed so editor surfaces and pattern matches
-- agree on the canonical name.
--
-- The phantom enum on `Id<Bot>` is updated in the same commit (engine-
-- side); existing `entity_instances` rows referenced via that tagged Id
-- continue to address the same UUIDs — only the entity_type label
-- changes.

UPDATE entity_instances
SET entity_type = 'Bot'
WHERE entity_type = 'bot';

-- Subscription metadata sometimes records `entityType: "bot"` for
-- downstream filters. Keep it consistent so listings still join.
UPDATE subscriptions
SET metadata = jsonb_set(metadata, '{entityType}', '"Bot"')
WHERE metadata ->> 'entityType' = 'bot';
