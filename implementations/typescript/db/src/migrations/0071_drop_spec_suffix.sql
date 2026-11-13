-- Phase 3.4b of typeclass-substrate-completion — drop the `Spec` suffix from
-- spec-record persistence. `entity_instances.entity_type` for spec-record
-- instances moves from `<ClassName>Spec` to the suffix-free `<ClassName>`
-- (e.g. `LabelableSpec` -> `Labelable`). The `Email` capability is renamed
-- to `EmailService` (the suffix-free `Email` would collide with the data
-- entity `Email`); its className carriers move `Email` -> `EmailService`.
--
-- Idempotent + defensive. Staging probe (2026-05-29) returned ZERO rows in
-- every carrier shape:
--   entity_instances.entity_type LIKE '%Spec'         -> 0
--   entity_instances.data->>'class'/'className' *Spec -> 0
--   typeclass_instances.class_name LIKE '%Spec'       -> 0
-- (live spec instances are suffix-free class_name rows in typeclass_instances:
-- Describable/Emojiable/Iconable/Labelable). Prior phases (1, 2.5, 4) found the
-- same. The migration must still ship so any production row gets renamed.
--
-- NOTE: nested Constraint `{class:{$tag:"Id",entityId:"<X>Spec"}}` refs are
-- NOT renamed here — the 162 Constraint entityIds stay `<X>Spec` (bridged)
-- until Phase 3.3 completes the clean break. Hence no JSONB walker (unlike
-- 0070); only the persisted spec-instance entity_type + the Email className.
--
-- Carrier shapes handled:
--   1. entity_instances.entity_type        — `<X>Spec` row type marker -> `<X>`
--   2. entity_instances.data->>'class'      — Email -> EmailService (others
--      were already suffix-free classNames; only the Email rename applies)
--   3. entity_instances.data->>'className'  — Email -> EmailService (Shape A)
--   4. typeclass_instances.class_name       — Email -> EmailService

BEGIN;

-- Rename table: spec entity_type (`<X>Spec`) -> suffix-free class name.
-- EmailSpec -> EmailService (collision with the data entity `Email`).
CREATE TEMP TABLE phase34b_renames (old_type text PRIMARY KEY, new_type text NOT NULL) ON COMMIT DROP;
INSERT INTO phase34b_renames (old_type, new_type) VALUES
  ('AISpec', 'AI'),
  ('AddressFormatSpec', 'AddressFormat'),
  ('AggregableSpec', 'Aggregable'),
  ('AliasableSpec', 'Aliasable'),
  ('CategorizableSpec', 'Categorizable'),
  ('CodeableSpec', 'Codeable'),
  ('CompilableSpec', 'Compilable'),
  ('ConversationalSpec', 'Conversational'),
  ('DateFormatSpec', 'DateFormat'),
  ('DecidableMembershipSpec', 'DecidableMembership'),
  ('DecodableSpec', 'Decodable'),
  ('DescribableSpec', 'Describable'),
  ('DiscoverableSpec', 'Discoverable'),
  ('EmailSpec', 'EmailService'),
  ('EmojiableSpec', 'Emojiable'),
  ('EncodableSpec', 'Encodable'),
  ('EvaluatorSpec', 'Evaluator'),
  ('ExchangeRateSpec', 'ExchangeRate'),
  ('ExemplifiableSpec', 'Exemplifiable'),
  ('ExportableSpec', 'Exportable'),
  ('FilterableSpec', 'Filterable'),
  ('GroupableSpec', 'Groupable'),
  ('HandleFormatSpec', 'HandleFormat'),
  ('HasControlFlowSpec', 'HasControlFlow'),
  ('HasDefaultSpec', 'HasDefault'),
  ('HasEmailSpec', 'HasEmail'),
  ('HasFileSystemSpec', 'HasFileSystem'),
  ('HasHTTPSpec', 'HasHTTP'),
  ('HasIOSpec', 'HasIO'),
  ('HasLogSpec', 'HasLog'),
  ('HasNetworkSpec', 'HasNetwork'),
  ('HasPreviewSpec', 'HasPreview'),
  ('HasRandomSpec', 'HasRandom'),
  ('HasSocialMediaSpec', 'HasSocialMedia'),
  ('HasStateIOSpec', 'HasStateIO'),
  ('HasStdinSpec', 'HasStdin'),
  ('HasStdoutSpec', 'HasStdout'),
  ('HasTelegramBotSpec', 'HasTelegramBot'),
  ('HasTimeSpec', 'HasTime'),
  ('HasWasmBuilderSpec', 'HasWasmBuilder'),
  ('IOInvokableSpec', 'IOInvokable'),
  ('IconableSpec', 'Iconable'),
  ('InfixableSpec', 'Infixable'),
  ('InputableSpec', 'Inputable'),
  ('IsoSpec', 'Iso'),
  ('LabelableSpec', 'Labelable'),
  ('LayoutSpec', 'Layout'),
  ('LensSpec', 'Lens'),
  ('MessagingSpec', 'Messaging'),
  ('MigrationSpec', 'Migration'),
  ('PaymentSpec', 'Payment'),
  ('PhoneFormatSpec', 'PhoneFormat'),
  ('PrefixableSpec', 'Prefixable'),
  ('ProverSpec', 'Prover'),
  ('ReferenceableSpec', 'Referenceable'),
  ('RenderableSpec', 'Renderable'),
  ('RepresentationalSpec', 'Representational'),
  ('ResolvableSpec', 'Resolvable'),
  ('SampleableSpec', 'Sampleable'),
  ('SocialSpec', 'Social'),
  ('SoundableSpec', 'Soundable'),
  ('SpatialSpec', 'Spatial'),
  ('StorageSpec', 'Storage'),
  ('StoryboardableSpec', 'Storyboardable'),
  ('TaggableSpec', 'Taggable'),
  ('TelegramBotConfigSpec', 'TelegramBotConfig'),
  ('TelegramBusinessSpec', 'TelegramBusiness'),
  ('TelegramCallbacksSpec', 'TelegramCallbacks'),
  ('TelegramChatAdminSpec', 'TelegramChatAdmin'),
  ('TelegramFilesSpec', 'TelegramFiles'),
  ('TelegramForumTopicsSpec', 'TelegramForumTopics'),
  ('TelegramGamesSpec', 'TelegramGames'),
  ('TelegramInlineModeSpec', 'TelegramInlineMode'),
  ('TelegramLifecycleSpec', 'TelegramLifecycle'),
  ('TelegramMediaSpec', 'TelegramMedia'),
  ('TelegramMessagesSpec', 'TelegramMessages'),
  ('TelegramPassportSpec', 'TelegramPassport'),
  ('TelegramPaymentsSpec', 'TelegramPayments'),
  ('TelegramPollsSpec', 'TelegramPolls'),
  ('TelegramStickersSpec', 'TelegramStickers'),
  ('TelegramWebhooksSpec', 'TelegramWebhooks'),
  ('TruthySpec', 'Truthy'),
  ('UndefinableSpec', 'Undefinable'),
  ('VersionableSpec', 'Versionable'),
  ('ViewableSpec', 'Viewable');

-- Shape 1: entity_instances.entity_type — the spec-record row type marker.
UPDATE entity_instances ei
SET entity_type = r.new_type
FROM phase34b_renames r
WHERE ei.entity_type = r.old_type;

-- Shape 2/3: the Email capability className (the only className that changed;
-- the other 84 classNames were already suffix-free, so data.class/className
-- need no general rename). Defensive — staging showed zero rows.
UPDATE entity_instances ei
SET data = jsonb_set(ei.data, '{class}', to_jsonb('EmailService'::text))
WHERE ei.data->>'class' = 'Email';

UPDATE entity_instances ei
SET data = jsonb_set(ei.data, '{className}', to_jsonb('EmailService'::text))
WHERE ei.data->>'className' = 'Email';

-- Shape 4: typeclass_instances.class_name — Email capability instances.
UPDATE typeclass_instances ti
SET class_name = 'EmailService',
    updated_at = NOW()
WHERE ti.class_name = 'Email';

COMMIT;
