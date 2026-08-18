import { prisma } from "../src/db";

/**
 * Empties every table, leaving the schema and migrations alone.
 *
 * Distinct from `prisma migrate reset`, which drops the schema and replays
 * every migration — correct when the schema itself is wrong, and far heavier
 * than is wanted for the usual case, which is a demo that needs a clean slate
 * between runs.
 *
 * Nothing on-chain is touched. Notes minted under a superseded factory stay
 * exactly where they are; this only forgets that the service was indexing
 * them, which is the whole meaning of clearing the database here.
 */

/** Children before parents, so a foreign key never blocks a delete. */
const ORDER = [
  "collection",
  "note",
  "extraction",
  "document",
  "zoyaMessage",
  "session",
  "authNonce",
  "issuerApplication",
] as const;

const client = prisma as unknown as Record<
  string,
  { deleteMany: (args: object) => Promise<{ count: number }>; count: () => Promise<number> }
>;

const before: Record<string, number> = {};
for (const table of ORDER) before[table] = await client[table]!.count();

const total = Object.values(before).reduce((sum, n) => sum + n, 0);
if (total === 0) {
  console.log("Already empty.");
} else {
  for (const table of ORDER) {
    const { count } = await client[table]!.deleteMany({});
    if (count > 0) console.log(`  ${String(count).padStart(5)}  ${table}`);
  }
  console.log(`\n${total} rows deleted across ${ORDER.length} tables.`);
}

// Asserted rather than assumed: a table added later and missed here would
// otherwise leave rows behind silently, and a "clean" database that is not
// clean is worse than one that never claimed to be.
const left = await Promise.all(ORDER.map((t) => client[t]!.count()));
const remaining = left.reduce((sum, n) => sum + n, 0);
if (remaining !== 0) {
  console.error(`\n${remaining} rows survived. Check ORDER against schema.prisma.`);
  process.exit(1);
}

await prisma.$disconnect();
