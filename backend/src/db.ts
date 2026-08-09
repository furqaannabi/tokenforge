import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Prisma over the node-postgres driver adapter.
 *
 * The adapter routes queries through `pg` rather than Prisma's own binary
 * engine, which keeps the runtime free of a native engine binary — worth having
 * when the service may end up somewhere without one.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env, or start a throwaway database with `bunx prisma dev`.",
  );
}

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });

export type { Document, Extraction, Note } from "../generated/prisma/client";
