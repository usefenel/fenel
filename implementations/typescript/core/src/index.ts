export * from "./fields/index";
export {
  ValidationError,
  type ValidationIssue,
} from "./errors";
export { dispatch } from "./dispatch";
export {
  saveFieldDefinitionBundle,
  queryFieldDefinitionCatalog,
  type SaveFieldDefinitionBundleRequest,
  type FieldDefinitionCommandResult,
  type FieldDefinitionCommandDependencies,
  type FieldDefinitionCatalogPage,
} from "./field-definition-command";
export { validate, validateForm } from "@fenel/engine/validation";
export {
  registerAction,
  getAction,
  listActions,
  type ActionContext,
  type ActionResult,
  type ActionDefinition,
} from "./actions/index";
export {
  userSubject,
  botSubject,
  anonymousSubject,
  subjectAccountId,
  requireAccountId,
  subjectActorId,
  isAuthenticated,
  type Subject,
} from "./subject";
// rights R2a — `./permissions/` is DELETED. The Subject × Action × Resource
// product it exported was the wrong foundation (`design/rights-floor.md` §1),
// and subordinating it would have kept `mem.where.prov`'s blast radius on a
// policy path. Authority is `design/authority.md`.
export {
  setPassword,
  issueSession,
  resolveToken,
  resolveReaderAccount,
  personalAccountForToken,
  type ReaderAccountOutcome,
  type PersonalAccountOutcome,
  revokeToken,
  listAccounts,
  switchAccount,
  devLogin,
  loginWithPassword,
  bootstrapAdmin,
  sessionCookieHeader,
  clearSessionCookieHeader,
  parseCookieHeader,
  type AccountChoice,
  type AccountChoices,
  type AccountSwitch,
  type IssueSessionInput,
  type IssuedSession,
  type ResolvedSession,
  type UserProfile,
  type DevLoginInput,
  type PasswordLoginInput,
  type BootstrapAdminInput,
} from "./auth";
