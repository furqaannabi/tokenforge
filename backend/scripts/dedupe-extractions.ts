#!/usr/bin/env bun
/**
 * Removes duplicate extractions — more than one for the same document.
 *
 *   bun scripts/dedupe-extractions.ts          # report only
 *   bun scripts/dedupe-extractions.ts --apply  # delete them
 *
 * Which one survives is not arbitrary. A minted extraction is kept whatever
 * else exists, because a Note row points at it and deleting it would orphan a
 * token that is live on a public chain. Failing that, the most recent, which
 * is the one somebody was last looking at.
 *
 * Dry by default. A script that deletes rows the first time you run it is one
 * you find out about afterwards.
 */

import { prisma } from "../src/db";

const apply = process.argv.includes("--apply");

const documents = await prisma.document.findMany({
  include: {
    extractions: { include: { note: true }, orderBy: { createdAt: "desc" } },
  },
});

const doomed: { id: string; status: string; file: string }[] = [];

for (const document of documents) {
  if (document.extractions.length < 2) continue;

  const keep =
    document.extractions.find((row) => row.note) ?? document.extractions[0]!;

  console.log(`\n${document.filename}`);
  for (const row of document.extractions) {
    const held = row.id === keep.id;
    console.log(
      `  ${held ? "keep  " : "DELETE"} ${row.id}  ${row.status.padEnd(13)}` +
        `${row.note ? " minted" : ""}`,
    );
    if (!held) {
      doomed.push({ id: row.id, status: row.status, file: document.filename });
    }
  }
}

if (doomed.length === 0) {
  console.log("\nNo duplicates. Every document has at most one extraction.\n");
  process.exit(0);
}

// Refuse to remove anything a note depends on, whatever the selection above
// decided. Cheap, and the one mistake here is unrecoverable.
const minted = await prisma.extraction.count({
  where: { id: { in: doomed.map((row) => row.id) }, note: { isNot: null } },
});
if (minted > 0) {
  console.error(`\nAborting: ${minted} of these have a minted note.\n`);
  process.exit(1);
}

if (!apply) {
  console.log(`\n${doomed.length} duplicate(s). Re-run with --apply to delete.\n`);
  process.exit(0);
}

const { count } = await prisma.extraction.deleteMany({
  where: { id: { in: doomed.map((row) => row.id) } },
});
console.log(`\nDeleted ${count}.\n`);
