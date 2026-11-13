// Plan entity now lives in entity_instances. This file keeps the JSONB types
// callers still depend on (PlanGrant, PlanStep) until they migrate to types
// derived from the FenelType definition.

export type PlanGrant = {
  entitlement: string;
  startAt?: string; // "previous_expiry" or undefined
  payload?: Record<string, unknown>;
};

export type PlanStep = {
  id: string;
  amount: number;
  currency: string;
  providers: string[];
  grants: PlanGrant[];
};
