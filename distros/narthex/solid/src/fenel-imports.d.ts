// Type declaration for `?raw` imports of `.fenel` source files.
// Both Bun and Vite resolve `import x from "./foo.fenel?raw"` to the
// file's raw text content; this declaration just makes TypeScript
// accept the pattern. See
// `fenel/modules/telegram/run-collector.fenel`
// for the canonical example. (Extension is `.fenel` — `.fnl` is the
// Fennel-lang extension and `.fen` is chess Forsyth-Edwards notation.)

declare module "*.fenel?raw" {
  const content: string;
  export default content;
}
