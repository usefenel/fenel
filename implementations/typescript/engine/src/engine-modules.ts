// ---------------------------------------------------------------------------
// engine-modules — the engineRequire target aggregator (GENERATED shape, hand-maintained).
//
// browser-engine-compat Phase 1b: statically imports every module that the
// engine's internal `engineRequire("<id>")` calls resolve (see engine-require.ts),
// and registers each namespace under its canonical id. This guarantees (a) every
// target is BUNDLED (static imports are never tree-shaken away) and (b) every
// target has EVALUATED + registered by the time a runtime dispatch calls
// engineRequire. Imported LAST by index.ts, so its imports are all no-ops for the
// modules index already pulled (no eval-order change) and only tail-load any
// require-only target — after the rest of the graph is up, so their deps are ready.
//
// When a NEW engine-internal `require("./x")`/`engineRequire("x")` target is
// added, add it here too (the id = path relative to engine/src, forward-slashed).
// ---------------------------------------------------------------------------

import { registerEngineModule } from "./engine-require";

import * as __m_aggregable from "./aggregable";
import * as __m_compile_call_bindings from "./compile-call-bindings";
import * as __m_compile_field_slots from "./compile-field-slots";
import * as __m_compiler_metadata_view from "./compiler-metadata-view";
import * as __m_dependent_types from "./dependent-types";
import * as __m_effect_dispatch from "./effect-dispatch";
import * as __m_effect_bootstrap_helpers from "./effect-bootstrap-helpers";
import * as __m_engine_bodies_dispatch from "./engine-bodies-dispatch";
import * as __m_fenel_check from "./fenel-check";
import * as __m_fenel_module from "./fenel-module";
import * as __m_field_meta from "./field-meta";
import * as __m_format_presets from "./format-presets";
import * as __m_generated_compiled_parser_generated from "./generated/compiled-parser.generated";
import * as __m_generated_compiled_resolver_generated from "./generated/compiled-resolver.generated";
import * as __m_input_layer from "./input-layer";
import * as __m_json_logic from "./json-logic";
import * as __m_kernel from "./kernel";
import * as __m_locale from "./locale";
import * as __m_modules_compile_wasm from "./modules/compile-wasm";
import * as __m_modules_compiler_target_entities from "./modules/compiler-target-entities";
import * as __m_modules_codec from "./modules/codec";
import * as __m_modules_decidable_membership from "./modules/decidable-membership";
import * as __m_modules_dispatch from "./modules/dispatch";
import * as __m_modules_email from "./modules/email";
import * as __m_modules_engine from "./modules/engine";
import * as __m_modules_evaluator_strategies from "./modules/evaluator-strategies";
import * as __m_modules_formats from "./modules/formats";
import * as __m_modules_locale from "./modules/locale";
import * as __m_modules_notion from "./modules/notion";
import * as __m_modules_prover from "./modules/prover";
import * as __m_modules_runtime from "./modules/runtime";
import * as __m_modules_std from "./modules/std";
import * as __m_modules_time from "./modules/time";
import * as __m_modules_units from "./modules/units";
import * as __m_pattern from "./pattern";
import * as __m_regex_shim from "./regex-shim";
import * as __m_repository_identity_manifest from "./repository-identity-manifest";
import * as __m_registry from "./registry";
import * as __m_set_algebra from "./set-algebra";
import * as __m_set_marker from "./set-marker";
import * as __m_signature_inference from "./signature-inference";
import * as __m_system_entities from "./system-entities";
import * as __m_system_registry from "./system-registry";
import * as __m_type_catalog from "./type-catalog";
import * as __m_type_foundation from "./type-foundation";
import * as __m_types from "./types";
import * as __m_validate from "./validate";
import * as __m_validation_hints from "./validation-hints";

registerEngineModule("aggregable", __m_aggregable);
registerEngineModule("compile-call-bindings", __m_compile_call_bindings);
registerEngineModule("compile-field-slots", __m_compile_field_slots);
registerEngineModule("compiler-metadata-view", __m_compiler_metadata_view);
registerEngineModule("dependent-types", __m_dependent_types);
registerEngineModule("effect-dispatch", __m_effect_dispatch);
registerEngineModule("effect-bootstrap-helpers", __m_effect_bootstrap_helpers);
registerEngineModule("engine-bodies-dispatch", __m_engine_bodies_dispatch);
registerEngineModule("fenel-check", __m_fenel_check);
registerEngineModule("fenel-module", __m_fenel_module);
registerEngineModule("field-meta", __m_field_meta);
registerEngineModule("format-presets", __m_format_presets);
registerEngineModule("generated/compiled-parser.generated", __m_generated_compiled_parser_generated);
registerEngineModule("generated/compiled-resolver.generated", __m_generated_compiled_resolver_generated);
registerEngineModule("input-layer", __m_input_layer);
registerEngineModule("json-logic", __m_json_logic);
registerEngineModule("kernel", __m_kernel);
registerEngineModule("locale", __m_locale);
registerEngineModule("modules/compile-wasm", __m_modules_compile_wasm);
registerEngineModule("modules/compiler-target-entities", __m_modules_compiler_target_entities);
registerEngineModule("modules/codec", __m_modules_codec);
registerEngineModule("modules/decidable-membership", __m_modules_decidable_membership);
registerEngineModule("modules/dispatch", __m_modules_dispatch);
registerEngineModule("modules/email", __m_modules_email);
registerEngineModule("modules/engine", __m_modules_engine);
registerEngineModule("modules/evaluator-strategies", __m_modules_evaluator_strategies);
registerEngineModule("modules/formats", __m_modules_formats);
registerEngineModule("modules/locale", __m_modules_locale);
registerEngineModule("modules/notion", __m_modules_notion);
registerEngineModule("modules/prover", __m_modules_prover);
registerEngineModule("modules/runtime", __m_modules_runtime);
registerEngineModule("modules/std", __m_modules_std);
registerEngineModule("modules/time", __m_modules_time);
registerEngineModule("modules/units", __m_modules_units);
registerEngineModule("pattern", __m_pattern);
registerEngineModule("regex-shim", __m_regex_shim);
registerEngineModule("repository-identity-manifest", __m_repository_identity_manifest);
registerEngineModule("registry", __m_registry);
registerEngineModule("set-algebra", __m_set_algebra);
registerEngineModule("set-marker", __m_set_marker);
registerEngineModule("signature-inference", __m_signature_inference);
registerEngineModule("system-entities", __m_system_entities);
registerEngineModule("system-registry", __m_system_registry);
registerEngineModule("type-catalog", __m_type_catalog);
registerEngineModule("type-foundation", __m_type_foundation);
registerEngineModule("types", __m_types);
registerEngineModule("validate", __m_validate);
registerEngineModule("validation-hints", __m_validation_hints);
