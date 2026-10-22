import { defineConfig, devices } from "@playwright/test";

/**
 * E2E reproducible SIN credenciales externas: levanta los simuladores de contrato
 * (Chatwoot/Meta/IA) y la app con una base dedicada (loopchat_e2e).
 * Las pruebas reales con Meta/IA se documentan en docs/qa-final.md.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const DB = process.env.E2E_DATABASE_URL ?? "postgres://loopchat:loopchat@localhost:5432/loopchat_e2e";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, dependencies: ["setup"], testIgnore: [/global\.setup\.ts/, /mobile\.spec\.ts/] },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }, dependencies: ["setup"], testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    { command: "npx tsx tools/chatwoot-sim/server.ts", url: "http://localhost:3011/__sim/health", reuseExistingServer: true, timeout: 30_000 },
    { command: "npx tsx tools/ai-sim/server.ts", url: "http://localhost:3012/__sim/requests", reuseExistingServer: true, timeout: 30_000 },
    {
      // caché limpia en cada corrida: el caché persistente de desarrollo entre corridas causó fallas de hidratación
      command: `node -e "require('fs').rmSync('.next-e2e',{recursive:true,force:true})" && npx next dev --port ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DATABASE_URL: DB,
        APP_URL: `http://localhost:${PORT}`,
        CHATWOOT_BASE_URL: "http://localhost:3011",
        CHATWOOT_PLATFORM_TOKEN: "sim-platform-token",
        CHATWOOT_WEBHOOK_TARGET_URL: `http://localhost:${PORT}`,
        META_GRAPH_BASE_URL: "http://localhost:3011/meta-graph/v22.0",
        LOOPCHAT_ALLOW_PRIVATE_URLS: "true",
        LOOPCHAT_INLINE_WORKER: "true",
        LOOPCHAT_DEMO_MODE: "true",
        DISABLE_RATE_LIMIT: "true",
        STORAGE_DIR: "./storage-e2e",
        SMTP_URL: "",
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
});
