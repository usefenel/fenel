// ---------------------------------------------------------------------------
// Notion runtime handlers — register one IO handler per `notion.<endpoint>`
// ioAction declared in the engine's notion module. Each handler reads
// `token` + endpoint params from the call, runs request-side encoders
// (Fenel → Notion wire), sends the HTTP request, then runs response-side
// decoders (Notion wire → Fenel `$tag` form).
//
// All endpoints run through `withNotionCall`, which catches
// NotionRateLimitError from the client and converts it to a durable
// `waiting_timer` suspend — same shape Telegram uses.
// ---------------------------------------------------------------------------

import type { ModuleRegistry } from "@fenel/engine/registry";
import type { IOHandlerResult } from "@fenel/engine/types";
import { Just } from "@fenel/engine/type-foundation";
import { callNotion, NotionRateLimitError } from "./notion-client";
import {
  decodePage,
  decodeDatabase,
  decodeBlock,
  decodeNotionUser,
  decodeComment,
  decodeSearchResult,
  decodePaginatedList,
  encodeParent,
  encodeBlockContent,
  encodeIcon,
  encodeCover,
  encodeFilter,
  encodeSort,
  encodeRichText,
  encodeCommentParent,
  encodeSearchObjectFilter,
  encodeSearchSort,
  encodePropertyWritesObject,
} from "./notion-codec";

// ---------------------------------------------------------------------------
// Param helpers
// ---------------------------------------------------------------------------

/** Unwrap a Fenel `Maybe a` to `a | undefined`. */
function unwrapMaybe<T = unknown>(v: unknown): T | undefined {
  if (v == null) return undefined;
  if (typeof v !== "object") return v as T;
  const tag = (v as { $tag?: unknown }).$tag;
  if (tag === "Just") return (v as { _0: T })._0;
  if (tag === "Nothing") return undefined;
  return v as T;
}

function requiredString(params: Record<string, unknown>, key: string, ctx: string): string {
  const v = params[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${ctx}: '${key}' must be a non-empty string`);
  }
  return v;
}

/** Catch NotionRateLimitError and convert to a `waiting_timer` suspend.
 *  Other errors propagate. */
async function withNotionCall(fn: () => Promise<unknown>): Promise<IOHandlerResult> {
  try {
    const value = await fn();
    return { action: "continue", value };
  } catch (e) {
    if (e instanceof NotionRateLimitError) {
      const wakeAt = new Date(Date.now() + e.retryAfterSeconds * 1000).toISOString();
      return {
        action: "suspend",
        status: "waiting_timer",
        meta: Just({
          $tag: "WaitTimer",
          wakeAt,
          retryReason: Just({ $tag: "NotionRetry", description: e.description }),
        }),
      };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerNotionHandlers(reg: ModuleRegistry): void {
  // ----- Pages -----

  reg.registerIOHandler("notion.retrievePage", async (params) => {
    const token = requiredString(params, "token", "notion.retrievePage");
    const pageId = requiredString(params, "pageId", "notion.retrievePage");
    return withNotionCall(async () => {
      const raw = await callNotion(token, "GET", `/pages/${encodeURIComponent(pageId)}`);
      return decodePage(raw);
    });
  });

  reg.registerIOHandler("notion.createPage", async (params) => {
    const token = requiredString(params, "token", "notion.createPage");
    const parent = encodeParent(params["parent"]);
    const properties = encodePropertyWritesObject(params["properties"]);
    const children = Array.isArray(params["children"])
      ? params["children"].map(encodeBlockContent)
      : [];
    const icon = unwrapMaybe(params["icon"]);
    const cover = unwrapMaybe(params["cover"]);
    const body: Record<string, unknown> = { parent, properties, children };
    if (icon !== undefined) body.icon = encodeIcon(icon);
    if (cover !== undefined) body.cover = encodeCover(cover);
    return withNotionCall(async () => {
      const raw = await callNotion(token, "POST", "/pages", body);
      return decodePage(raw);
    });
  });

  reg.registerIOHandler("notion.updatePage", async (params) => {
    const token = requiredString(params, "token", "notion.updatePage");
    const pageId = requiredString(params, "pageId", "notion.updatePage");
    const properties = encodePropertyWritesObject(params["properties"]);
    const archived = unwrapMaybe<boolean>(params["archived"]);
    const icon = unwrapMaybe(params["icon"]);
    const cover = unwrapMaybe(params["cover"]);
    const body: Record<string, unknown> = {};
    if (Object.keys(properties).length > 0) body.properties = properties;
    if (archived !== undefined) body.archived = archived;
    if (icon !== undefined) body.icon = encodeIcon(icon);
    if (cover !== undefined) body.cover = encodeCover(cover);
    return withNotionCall(async () => {
      const raw = await callNotion(
        token,
        "PATCH",
        `/pages/${encodeURIComponent(pageId)}`,
        body,
      );
      return decodePage(raw);
    });
  });

  // ----- Databases -----

  reg.registerIOHandler("notion.retrieveDatabase", async (params) => {
    const token = requiredString(params, "token", "notion.retrieveDatabase");
    const databaseId = requiredString(params, "databaseId", "notion.retrieveDatabase");
    return withNotionCall(async () => {
      const raw = await callNotion(
        token,
        "GET",
        `/databases/${encodeURIComponent(databaseId)}`,
      );
      return decodeDatabase(raw);
    });
  });

  reg.registerIOHandler("notion.queryDatabase", async (params) => {
    const token = requiredString(params, "token", "notion.queryDatabase");
    const databaseId = requiredString(params, "databaseId", "notion.queryDatabase");
    const filter = unwrapMaybe(params["filter"]);
    const sorts = Array.isArray(params["sorts"]) ? params["sorts"].map(encodeSort) : [];
    const startCursor = unwrapMaybe<string>(params["startCursor"]);
    const pageSize = unwrapMaybe<number>(params["pageSize"]);
    const body: Record<string, unknown> = {};
    if (filter !== undefined) body.filter = encodeFilter(filter);
    if (sorts.length > 0) body.sorts = sorts;
    if (startCursor !== undefined) body.start_cursor = startCursor;
    if (pageSize !== undefined) body.page_size = pageSize;
    return withNotionCall(async () => {
      const raw = await callNotion(
        token,
        "POST",
        `/databases/${encodeURIComponent(databaseId)}/query`,
        body,
      );
      return decodePaginatedList(raw, decodePage);
    });
  });

  // ----- Blocks -----

  reg.registerIOHandler("notion.retrieveBlock", async (params) => {
    const token = requiredString(params, "token", "notion.retrieveBlock");
    const blockId = requiredString(params, "blockId", "notion.retrieveBlock");
    return withNotionCall(async () => {
      const raw = await callNotion(
        token,
        "GET",
        `/blocks/${encodeURIComponent(blockId)}`,
      );
      return decodeBlock(raw);
    });
  });

  reg.registerIOHandler("notion.retrieveBlockChildren", async (params) => {
    const token = requiredString(params, "token", "notion.retrieveBlockChildren");
    const blockId = requiredString(params, "blockId", "notion.retrieveBlockChildren");
    const startCursor = unwrapMaybe<string>(params["startCursor"]);
    const pageSize = unwrapMaybe<number>(params["pageSize"]);
    const query = new URLSearchParams();
    if (startCursor !== undefined) query.set("start_cursor", startCursor);
    if (pageSize !== undefined) query.set("page_size", String(pageSize));
    const qs = query.toString();
    const path =
      `/blocks/${encodeURIComponent(blockId)}/children` + (qs ? `?${qs}` : "");
    return withNotionCall(async () => {
      const raw = await callNotion(token, "GET", path);
      return decodePaginatedList(raw, decodeBlock);
    });
  });

  reg.registerIOHandler("notion.appendBlockChildren", async (params) => {
    const token = requiredString(params, "token", "notion.appendBlockChildren");
    const blockId = requiredString(params, "blockId", "notion.appendBlockChildren");
    const children = Array.isArray(params["children"])
      ? params["children"].map(encodeBlockContent)
      : [];
    const after = unwrapMaybe<string>(params["after"]);
    const body: Record<string, unknown> = { children };
    if (after !== undefined) body.after = after;
    return withNotionCall(async () => {
      const raw = await callNotion(
        token,
        "PATCH",
        `/blocks/${encodeURIComponent(blockId)}/children`,
        body,
      );
      return decodePaginatedList(raw, decodeBlock);
    });
  });

  reg.registerIOHandler("notion.updateBlock", async (params) => {
    const token = requiredString(params, "token", "notion.updateBlock");
    const blockId = requiredString(params, "blockId", "notion.updateBlock");
    const content = encodeBlockContent(params["content"]);
    const archived = unwrapMaybe<boolean>(params["archived"]);
    // Notion's PATCH /blocks/{id} accepts the type-keyed payload directly,
    // not wrapped in an `object: "block"` envelope. Strip that key from
    // the encoded content.
    const body: Record<string, unknown> = isObj(content)
      ? Object.fromEntries(
          Object.entries(content).filter(([k]) => k !== "object"),
        )
      : {};
    if (archived !== undefined) body.archived = archived;
    return withNotionCall(async () => {
      const raw = await callNotion(
        token,
        "PATCH",
        `/blocks/${encodeURIComponent(blockId)}`,
        body,
      );
      return decodeBlock(raw);
    });
  });

  reg.registerIOHandler("notion.deleteBlock", async (params) => {
    const token = requiredString(params, "token", "notion.deleteBlock");
    const blockId = requiredString(params, "blockId", "notion.deleteBlock");
    return withNotionCall(async () => {
      const raw = await callNotion(
        token,
        "DELETE",
        `/blocks/${encodeURIComponent(blockId)}`,
      );
      return decodeBlock(raw);
    });
  });

  // ----- Users -----

  reg.registerIOHandler("notion.retrieveUser", async (params) => {
    const token = requiredString(params, "token", "notion.retrieveUser");
    const userId = requiredString(params, "userId", "notion.retrieveUser");
    return withNotionCall(async () => {
      const raw = await callNotion(
        token,
        "GET",
        `/users/${encodeURIComponent(userId)}`,
      );
      return decodeNotionUser(raw);
    });
  });

  reg.registerIOHandler("notion.listUsers", async (params) => {
    const token = requiredString(params, "token", "notion.listUsers");
    const startCursor = unwrapMaybe<string>(params["startCursor"]);
    const pageSize = unwrapMaybe<number>(params["pageSize"]);
    const query = new URLSearchParams();
    if (startCursor !== undefined) query.set("start_cursor", startCursor);
    if (pageSize !== undefined) query.set("page_size", String(pageSize));
    const qs = query.toString();
    const path = `/users` + (qs ? `?${qs}` : "");
    return withNotionCall(async () => {
      const raw = await callNotion(token, "GET", path);
      return decodePaginatedList(raw, decodeNotionUser);
    });
  });

  reg.registerIOHandler("notion.retrieveMe", async (params) => {
    const token = requiredString(params, "token", "notion.retrieveMe");
    return withNotionCall(async () => {
      const raw = await callNotion(token, "GET", "/users/me");
      return decodeNotionUser(raw);
    });
  });

  // ----- Comments -----

  reg.registerIOHandler("notion.createComment", async (params) => {
    const token = requiredString(params, "token", "notion.createComment");
    const parent = encodeCommentParent(params["parent"]);
    const richText = Array.isArray(params["richText"])
      ? params["richText"].map(encodeRichText)
      : [];
    const body = { parent, rich_text: richText };
    return withNotionCall(async () => {
      const raw = await callNotion(token, "POST", "/comments", body);
      return decodeComment(raw);
    });
  });

  reg.registerIOHandler("notion.retrieveComments", async (params) => {
    const token = requiredString(params, "token", "notion.retrieveComments");
    const blockId = requiredString(params, "blockId", "notion.retrieveComments");
    const startCursor = unwrapMaybe<string>(params["startCursor"]);
    const pageSize = unwrapMaybe<number>(params["pageSize"]);
    const query = new URLSearchParams({ block_id: blockId });
    if (startCursor !== undefined) query.set("start_cursor", startCursor);
    if (pageSize !== undefined) query.set("page_size", String(pageSize));
    return withNotionCall(async () => {
      const raw = await callNotion(token, "GET", `/comments?${query.toString()}`);
      return decodePaginatedList(raw, decodeComment);
    });
  });

  // ----- Search -----

  reg.registerIOHandler("notion.search", async (params) => {
    const token = requiredString(params, "token", "notion.search");
    const queryText = unwrapMaybe<string>(params["query"]);
    const filter = unwrapMaybe(params["filter"]);
    const sort = unwrapMaybe(params["sort"]);
    const startCursor = unwrapMaybe<string>(params["startCursor"]);
    const pageSize = unwrapMaybe<number>(params["pageSize"]);
    const body: Record<string, unknown> = {};
    if (queryText !== undefined) body.query = queryText;
    if (filter !== undefined) {
      const encoded = encodeSearchObjectFilter(filter);
      if (encoded !== undefined) body.filter = encoded;
    }
    if (sort !== undefined) body.sort = encodeSearchSort(sort);
    if (startCursor !== undefined) body.start_cursor = startCursor;
    if (pageSize !== undefined) body.page_size = pageSize;
    return withNotionCall(async () => {
      const raw = await callNotion(token, "POST", "/search", body);
      return decodePaginatedList(raw, decodeSearchResult);
    });
  });
}

// ---------------------------------------------------------------------------
// Local helpers (used only by updateBlock to peel off the wire envelope)
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
