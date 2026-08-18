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
// Whether the extractor agrees with itself. The validator checks one reading
// against its own arithmetic; this checks two readings against each other, and
// nothing else in the pipeline can see that failure.
export * from "./crosscheck";
// Splitting a payment into principal and interest. Arithmetic the model was
// being asked to do and should not have been.
export * from "./amortise";
// What a budget buys from an offering. Arithmetic the assistant was doing in
// prose, and getting wrong in two directions at once.
export * from "./offer";
// Building and hashing a mint. Here rather than in the web app because the
// service now sends the transaction, and two implementations of `mintHash`
// would disagree the moment either was edited.
export * from "./mint";
