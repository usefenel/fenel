/** Import-free exact policy rows shared by the M3b preload and controller.
 * Loaded builtins are detective cache evidence, not worker source authority.
 * node:util source acquisition is separately pinned to types.isProxy only. */

export const COMPILED_ARTIFACT_LOADED_MODULE_BUILTINS = Object.freeze([
  "bun:main",
  "node:buffer",
  "node:crypto",
  "node:fs",
  "node:fs/promises",
  "node:module",
  "node:path",
  "node:url",
  "node:util",
] as const);

export const COMPILED_ARTIFACT_FIXED_PRESENT_ENVIRONMENT_KEYS = Object.freeze([
  "FENEL_PARSER_INTERPRETED",
  "FENEL_PARSER_LEGACY",
  "FENEL_PARSE_CACHE",
  "FENEL_RESOLVER_INTERPRETED",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
] as const);

export const COMPILED_ARTIFACT_DECLARED_ABSENT_ENVIRONMENT_KEYS = Object.freeze([
  "FENEL_DISPATCH_FENEL_PASSES",
  "FENEL_REGEX_SHIM_DEBUG",
  "FENEL_SIMULATE_BROWSER",
] as const);
