import { StreamLanguage, type StreamParser, type StringStream } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

type State = { inString: boolean; inTemplate: boolean; templateDepth: number };

/** The stream tokenizer behind `fenelLanguage`, exported for its tests. */
export const fenelParser: StreamParser<State> = {
  startState: () => ({ inString: false, inTemplate: false, templateDepth: 0 }),
  token(stream, state) {
    if (state.inTemplate) {
      if (stream.match("${")) {
        state.templateDepth++;
        return t.brace.toString();
      }
      if (state.templateDepth > 0) {
        if (stream.peek() === "}") {
          stream.next();
          state.templateDepth--;
          return t.brace.toString();
        }
        return tokenizeExpr(stream);
      }
      if (stream.peek() === "`") {
        stream.next();
        state.inTemplate = false;
        return t.string.toString();
      }
      if (stream.peek() === "\\") {
        stream.next();
        stream.next();
        return t.escape.toString();
      }
      stream.next();
      return t.string.toString();
    }

    if (stream.eatSpace()) return null;

    if (stream.match("--")) {
      stream.skipToEnd();
      return t.lineComment.toString();
    }

    if (stream.peek() === "`") {
      stream.next();
      state.inTemplate = true;
      return t.string.toString();
    }

    if (stream.peek() === '"') {
      stream.next();
      while (!stream.eol()) {
        if (stream.peek() === "\\") { stream.next(); stream.next(); continue; }
        if (stream.peek() === '"') { stream.next(); break; }
        stream.next();
      }
      return t.string.toString();
    }

    return tokenizeExpr(stream);
  },
};

function tokenizeExpr(stream: StringStream): string | null {
  // No `::`: annotations are spelled `(e : T)` with one colon, which is a
  // bracket token below like every other `:`.
  for (const op of ["==", "!=", "<=", ">=", "|>", "->", "<-", ".."]) {
    if (stream.match(op)) return t.operator.toString();
  }

  if (/[+\-*/%<>=|&!]/.test(stream.peek() ?? "")) {
    stream.next();
    return t.operator.toString();
  }

  if (/[0-9]/.test(stream.peek() ?? "")) {
    stream.eatWhile(/[0-9]/);
    if (stream.peek() === "." && !stream.match("..", false)) {
      stream.next();
      stream.eatWhile(/[0-9]/);
    }
    return t.number.toString();
  }

  if (stream.peek() === "\\") {
    stream.next();
    return t.keyword.toString();
  }

  if (/[(){}[\],;.:]/.test(stream.peek() ?? "")) {
    stream.next();
    return t.bracket.toString();
  }

  if (/[\p{L}_]/u.test(stream.peek() ?? "")) {
    const atLineStart = stream.sol();
    let word = "";
    while (!stream.eol() && /[\p{L}\p{N}_]/u.test(stream.peek() ?? "")) {
      word += stream.next();
    }

    const keywords = new Set([
      "let", "if", "then", "else", "case", "of", "where", "do",
      "type", "and", "or", "not", "true", "false", "read", "using",
    ]);
    if (keywords.has(word)) return t.keyword.toString();
    // `import` and `module` are contextual: declaration keywords only where a
    // declaration starts (elsewhere they stay ordinary names, e.g. a field).
    if (atLineStart && (word === "import" || word === "module")) return t.keyword.toString();

    if (word === "true" || word === "false") return t.bool.toString();

    if (word.length > 0 && word[0] === word[0]!.toUpperCase() && word[0] !== word[0]!.toLowerCase()) {
      return t.typeName.toString();
    }

    return t.variableName.toString();
  }

  stream.next();
  return null;
}

export const fenelLanguage = StreamLanguage.define(fenelParser);
