// Config aislada para el harness de auditoría (no forma parte de `npm test`).
// Uso: npx vitest run -c tests/audit/vitest.audit.config.mts
import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      "server-only": path.join(root, "tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/audit/**/*.audit.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    setupFiles: ["tests/helpers/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
