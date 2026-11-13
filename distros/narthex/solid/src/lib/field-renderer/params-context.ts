// ---------------------------------------------------------------------------
// Params context — typed FunctionParam list available to any widget that
// edits an expression-typed value. Email-template bodies, plan terms,
// computed fields etc. all want this context to expose typed variable
// references in their builder UIs.
//
// Provided by AdminForm when the caller passes `params={...}`. Widgets
// like MarkupExprEditor / StringExprEditor read from here instead of
// receiving a `params` prop directly.
// ---------------------------------------------------------------------------

import { createContext, useContext } from "solid-js";
import type { FieldDef } from "@fenel/engine/types";

const ParamsContext = createContext<FieldDef[]>([]);

export const ParamsProvider = ParamsContext;
export const useParams = () => useContext(ParamsContext);
