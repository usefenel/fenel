import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./implementations/typescript/db/src/schema/index.ts",
  out: "./implementations/typescript/db/src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"]!,
  },
});
