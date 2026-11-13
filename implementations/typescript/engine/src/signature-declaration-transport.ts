import type {
  FenelFunction,
  FenelModule,
  FunctionSignatureDeclaration,
  Interface,
  TypeScheme,
} from "./types";

// Exact-object provenance for thin module composition seams. The serializable
// FenelModule sidecar is authoritative; this association only preserves the
// declaration when a seam combines loaded functions without combining arrays.
const loadedDeclarations = new WeakMap<
  FenelFunction,
  FunctionSignatureDeclaration
>();

// Dispatch interfaces are structural compatibility projections of a source
// record type. Keep the parser-owned kinded scheme beside the exact projected
// object without changing its enumerable/runtime shape (many dispatch parity
// tests intentionally compare that shape byte-for-byte). Registry inference
// is the only semantic consumer.
type InterfaceTypeSchemeSource = {
  readonly scheme: TypeScheme;
  readonly sourceModule?: FenelModule;
};

const interfaceTypeSchemes = new WeakMap<Interface, InterfaceTypeSchemeSource>();

export function registerLoadedFunctionSignatureDeclaration(
  fn: FenelFunction,
  declaration: FunctionSignatureDeclaration,
): void {
  loadedDeclarations.set(fn, declaration);
}

export function getLoadedFunctionSignatureDeclaration(
  fn: FenelFunction,
): FunctionSignatureDeclaration | undefined {
  return loadedDeclarations.get(fn);
}

export function registerInterfaceTypeScheme(
  iface: Interface,
  scheme: TypeScheme,
  sourceModule?: FenelModule,
): void {
  interfaceTypeSchemes.set(iface, {
    scheme,
    ...(sourceModule === undefined ? {} : { sourceModule }),
  });
}

export function getInterfaceTypeScheme(
  iface: Interface,
): TypeScheme | undefined {
  return interfaceTypeSchemes.get(iface)?.scheme;
}

export function getInterfaceTypeSchemeSource(
  iface: Interface,
): InterfaceTypeSchemeSource | undefined {
  return interfaceTypeSchemes.get(iface);
}
