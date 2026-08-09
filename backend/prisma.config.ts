import { defineConfig } from "prisma/config";

/**
 * Bun loads .env for its own runtime, but the Prisma CLI is a Node process and
 * does not always inherit it — `prisma migrate` would then fail with a
 * confusing "datasource.url is required". Node's built-in loader fills the gap
 * without pulling in dotenv, which the Bun guidance in CLAUDE.md rules out.
 */
if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env on disk — fall through to whatever the environment already has.
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
