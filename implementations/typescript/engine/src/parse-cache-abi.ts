// Mechanical, engine-free ABI leaf shared by the live parse-cache reader and
// M3b's inert recovery stub. Keep this module free of generated imports.

/**
 * Semantic ABI of the JSON AST stored by the main parse cache.
 *
 * Source hashes cannot invalidate an unchanged `.fenel` file when the parser's
 * output contract changes. The generator embeds this epoch and the runtime
 * refuses an artifact whose epoch is not exactly current.
 *
 * ABI 4 (signature-substrate P4+4b slice 3f, R1) — the `type_def` frame now
 * emits a canonical key order.
 */
export const PARSE_CACHE_AST_ABI_VERSION = 4;

/**
 * Independent AST ABI for the cold-boot seed. ABI 2 carried declaration-bound
 * source schemes and multiline constructor fields from the sanctioned TS
 * parser. It remains disjoint so the seed can boot a main-cache rebuild.
 */
export const PARSER_BOOTSTRAP_AST_ABI_VERSION = 2;
