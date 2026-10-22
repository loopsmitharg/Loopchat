import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatorio"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET debe tener al menos 32 caracteres"),
  LOOPCHAT_ENCRYPTION_KEYS: z.string().min(1, "LOOPCHAT_ENCRYPTION_KEYS es obligatorio"),
  CHATWOOT_BASE_URL: z.string().url().optional(),
  CHATWOOT_PLATFORM_TOKEN: z.string().optional(),
  CHATWOOT_WEBHOOK_TARGET_URL: z.string().url().optional(),
  META_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com/v22.0"),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Loopchat <no-reply@localhost>"),
  STORAGE_DIR: z.string().default("./storage"),
  LOOPCHAT_INLINE_WORKER: z.enum(["true", "false"]).default("true"),
  LOOPCHAT_ALLOW_PRIVATE_URLS: z.enum(["true", "false"]).default("false"),
  LOOPCHAT_DEMO_MODE: z.enum(["true", "false"]).default("false"),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración inválida: ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.LOOPCHAT_ALLOW_PRIVATE_URLS === "true") {
    throw new Error("LOOPCHAT_ALLOW_PRIVATE_URLS no puede estar activo en producción");
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache() {
  cached = null;
}
