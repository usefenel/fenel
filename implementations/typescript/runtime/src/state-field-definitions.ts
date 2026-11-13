// Lazy, DB-free facade over the authorized field-definition state IO leaf.
// Keeping this module structural prevents core/API imports from eagerly
// loading the evaluator and its core/runtime registration cycle.

import type {
  AccountFieldDefinitionGraph,
  FieldPersistencePlan,
  FieldPersistenceSnapshot,
} from "@fenel/engine/field-authoring";

export type FieldDefinitionStatePlanCurrent = (
  current: AccountFieldDefinitionGraph,
) => FieldPersistencePlan | Promise<FieldPersistencePlan>;

export async function loadAccountFieldDefinitionGraphState(
  accountId: string,
): Promise<AccountFieldDefinitionGraph> {
  const { loadAccountFieldDefinitionGraphStateLeaf } = await import("./handlers/state");
  return loadAccountFieldDefinitionGraphStateLeaf(accountId);
}

export async function executeFieldDefinitionCommandTransactionState(
  accountId: string,
  planCurrent: FieldDefinitionStatePlanCurrent,
): Promise<FieldPersistenceSnapshot> {
  const { executeFieldDefinitionCommandTransactionStateLeaf } = await import(
    "./handlers/state"
  );
  return executeFieldDefinitionCommandTransactionStateLeaf(accountId, planCurrent);
}
