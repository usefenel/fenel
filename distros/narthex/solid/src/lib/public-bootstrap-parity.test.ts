// Lane E, Nov 8: the public reader adopts the bundled bootstrap's
// `previewMetadata` and `typeDescriptions` instead of recomputing them in the
// browser (about two minutes of main thread). This heavy check recomputes them
// in Bun from the current sources, the way generate-public-bootstrap.mjs does,
// and requires the bundled copies to be equal, so a drift fails in CI.
import { expect, test } from "bun:test";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { modulesFor } from "@fenel/engine/module-manifest";
import { dispatchRegistry } from "@fenel/engine/system-entities";
import { Nothing, List, Anything } from "@fenel/engine/type-foundation";
import { encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType } from "@fenel/engine/types";
import * as catalog from "./expression-runner/authoring-catalog";
import { SEED_VALUES } from "./expression-runner/seed-values";
import { createDetachedAuthoringEnvironment } from "./expression-runner/detached-authoring-environment";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import { createReaderPresentation } from "./reader-presentation";
import { loadPublicBootstrap } from "./public-bootstrap";
import { PUBLIC_SEED_NAMES, arrangePublicDemos, publicLocusDataForSession, publicSourceDemoValues, publicShowcaseSourceForSession, type PublicDemoValue } from "./public-locus-data";

test("the bundled bootstrap's derived projections equal a fresh recomputation from the current sources", async () => {
  const snapshot = await loadPublicBootstrap();
  const registry = createRepositoryRegistry(modulesFor("seed"), { dispatchRegistry });
  let environment: AuthoringSession["environment"] | undefined;
  const session: AuthoringSession = { mode: "detached", registry, evaluateContext: catalog.evaluateContextForCatalog(registry),
    get environment() { return environment ??= createDetachedAuthoringEnvironment(catalog.environmentForCatalog(catalog.buildSessionCatalog(registry))); },
    get catalog() { return this.environment.catalog; } };
  const presentation = createReaderPresentation(() => ({ registry, session, catalog: [] }));
  // The gallery examples (root and Data instead of files) come from the example corpus; their checked
  // expressions and types are the bootstrap's own, so no corpus import is needed.
  const demoItem = snapshot.root.items.find(item => item.id === "demo")!;
  const demoExpression = snapshot.root.expressions[`locus:${snapshot.root.id}:demo`] as ExprNode & { kind: "literal" };
  // The examples may sit inside a group (`Unfinished demos`): a nested record.
  type Fields = { name: string; value: ExprNode }[];
  type Types = { name: string; type: FenelType }[];
  const recordFields = (value: unknown): Fields | undefined => (value as { __record?: { fields: Fields } })?.__record?.fields;
  const find = (fields: Fields, types: Types, name: string): { value: ExprNode; type?: FenelType } | undefined => {
    for (const field of fields) {
      const type = types.find(row => row.name === field.name)?.type;
      if (field.name === name) return { value: field.value, ...(type ? { type } : {}) };
      const nested = field.value.kind === "literal" ? recordFields(field.value.value) : undefined;
      const nestedTypes = type && "$record" in type ? type.$record.fields as Types : undefined;
      const found = nested && nestedTypes && find(nested, nestedTypes, name);
      if (found) return found;
    }
    return undefined;
  };
  const demoFields = recordFields(demoExpression.value)!;
  const demoTypes = (demoItem.valueType as { $record: { fields: Types } }).$record.fields;
  const gallery: PublicDemoValue[] = PUBLIC_SEED_NAMES.map(name => {
    const field = find(demoFields, demoTypes, name);
    if (!field) throw new Error(`The bundled bootstrap lost the gallery example ${name}.`);
    const type = field.type;
    // The description is the example's own (its section entry is part of the projection).
    const description = SEED_VALUES.find(entry => entry.name === name)?.description ?? "";
    return { name, description, expr: field.value, ...(type && !("$ref" in type && type.$ref === "Any") ? { type } : {}) };
  });
  const data = publicLocusDataForSession(session,
    arrangePublicDemos([...publicSourceDemoValues(registry, Nothing, presentation, publicShowcaseSourceForSession(session)), ...gallery]), List(Anything), Nothing, presentation);
  expect(JSON.stringify(encodeCheckpointValue(data.root.previewMetadata)))
    .toBe(JSON.stringify(encodeCheckpointValue(snapshot.root.previewMetadata)));
  expect(JSON.stringify(encodeCheckpointValue(data.root.typeDescriptions)))
    .toBe(JSON.stringify(encodeCheckpointValue(snapshot.root.typeDescriptions)));
}, 1_200_000);
