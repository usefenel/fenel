#!/usr/bin/env bun
import { parse, ParseError } from "./fenel-parser";
import { print } from "./engine-bodies-dispatch";
import { resolveEvaluator } from "./evaluator-class";
import { stdNatives, stdNativesCtx } from "./modules/std";
import { createInterface } from "readline";
import { readFileSync } from "fs";

const ctx = { natives: stdNatives, nativesCtx: stdNativesCtx };

function run(src: string, env: Record<string, unknown> = {}): unknown {
  const ast = parse(src);
  return resolveEvaluator(ctx)(ast, env, ctx);
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "run" && rest[0]) {
  const src = readFileSync(rest[0], "utf-8");
  const result = run(src);
  if (result != null) console.log(typeof result === "object" ? JSON.stringify(result, null, 2) : result);
} else if (cmd === "eval" && rest[0]) {
  const result = run(rest.join(" "));
  if (result != null) console.log(typeof result === "object" ? JSON.stringify(result, null, 2) : result);
} else if (cmd === "parse" && rest[0]) {
  console.log(JSON.stringify(parse(rest.join(" ")), null, 2));
} else if (cmd === "print" && rest[0]) {
  console.log(print(parse(rest.join(" "))));
} else if (cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(`fenel — Fenel expression toolkit

  fenel              Interactive REPL
  fenel eval <expr>  Evaluate expression
  fenel run <file>   Run .fenel file
  fenel parse <expr> Show AST (JSON)
  fenel print <expr> Parse then pretty-print`);
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "fenel> " });
  console.log("Fenel REPL — type expressions, Ctrl+D to exit");
  rl.prompt();

  const env: Record<string, unknown> = {};

  rl.on("line", (line) => {
    const s = line.trim();
    if (!s) { rl.prompt(); return; }
    if (s === ":ast") { console.log("(type expression after :ast)"); rl.prompt(); return; }
    try {
      if (s.startsWith(":ast ")) {
        console.log(JSON.stringify(parse(s.slice(5)), null, 2));
      } else if (s.startsWith(":print ")) {
        console.log(print(parse(s.slice(7))));
      } else {
        const ast = parse(s);
        const result = resolveEvaluator(ctx)(ast, env, ctx);
        if (result != null) {
          console.log(typeof result === "object" ? JSON.stringify(result, null, 2) : result);
        }
      }
    } catch (e) {
      console.error(e instanceof ParseError ? e.message : e instanceof Error ? e.message : e);
    }
    rl.prompt();
  });

  rl.on("close", () => process.exit(0));
}
