/**
 * A fixed clock for the demo.
 *
 * The validator takes `now` as a parameter so its results are deterministic.
 * Pinning it here serves two purposes: the sample documents keep their intended
 * relationship to "today" however long after they were written the demo is run,
 * and server and client renders agree on which coupons are overdue — a live
 * `new Date()` on both sides is a hydration mismatch waiting to happen.
 */
export const DEMO_NOW = new Date("2026-08-09T00:00:00Z");
