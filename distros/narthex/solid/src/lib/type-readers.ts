// Compatibility surface for older Solid imports. The typed-ref authoring
// semantics live in @fenel/engine/authoring/environment; this file is now a
// frontend import shim only.

export {
  refHandle,
  refLiteralKind,
  resolveRefToType,
  typePositionRefHandle,
} from "@fenel/engine/authoring/environment";
