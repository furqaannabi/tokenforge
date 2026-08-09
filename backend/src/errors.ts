/**
 * The service is misconfigured, as opposed to the request being bad.
 *
 * Surfaced as 503 with the message intact, because the person who can fix a
 * missing key or bucket is the operator reading the response, and a generic
 * "Internal error" tells them nothing.
 */
export class ConfigurationError extends Error {}
