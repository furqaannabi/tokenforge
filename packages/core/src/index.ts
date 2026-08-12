/**
 * @tokenforge/core
 *
 * The extraction schema and the deterministic validator, shared by the web app
 * and the extraction service.
 *
 * These two things belong together and must exist exactly once. The schema is
 * the contract with the model, the shape stored in Postgres, and the shape the
 * review screen renders. The validator decides whether a set of terms may reach
 * a contract at all. If a reviewer's browser and the server ever disagreed
 * about that, the disagreement would surface as terms that pass review and then
 * revert on-chain — or worse, terms that mint when they should not have.
 */

export * from "./schema";
export * from "./validator";
// Building and hashing a mint. Here rather than in the web app because the
// service now sends the transaction, and two implementations of `mintHash`
// would disagree the moment either was edited.
export * from "./mint";
