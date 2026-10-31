import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// Local only; Vercel builds get their env from the project settings
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  schemaFilter: ["public"],
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED as string,
  },
});
