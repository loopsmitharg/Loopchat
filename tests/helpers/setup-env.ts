// Entorno de pruebas reproducible: DB dedicada y claves SOLO de test (no productivas).
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://loopchat:loopchat@localhost:5432/loopchat_test";
process.env.BETTER_AUTH_SECRET = "test-only-secret-0123456789abcdef0123456789";
process.env.LOOPCHAT_ENCRYPTION_KEYS = "t2:" + Buffer.alloc(32, 2).toString("base64") + ",t1:" + Buffer.alloc(32, 1).toString("base64");
process.env.APP_URL = "http://localhost:3000";
process.env.LOOPCHAT_ALLOW_PRIVATE_URLS = "true";
process.env.LOOPCHAT_INLINE_WORKER = "false";
process.env.DISABLE_RATE_LIMIT = "true";
process.env.STORAGE_DIR = process.env.STORAGE_DIR ?? "/tmp/loopchat-test-storage";
process.env.CHATWOOT_BASE_URL = "http://localhost:3011";
process.env.CHATWOOT_PLATFORM_TOKEN = "sim-platform-token";
process.env.CHATWOOT_WEBHOOK_TARGET_URL = "http://localhost:3013";
process.env.META_GRAPH_BASE_URL = "http://localhost:3011/meta-graph/v22.0";
process.env.AI_TEST_ANTHROPIC_BASE_URL = "http://localhost:3012";
process.env.AI_TEST_GEMINI_BASE_URL = "http://localhost:3012";
process.env.AI_REQUEST_TIMEOUT_MS = "2000";
