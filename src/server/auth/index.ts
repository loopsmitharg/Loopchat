import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { sendMail } from "../mail";

function createAuth() {
  const baseURL = process.env.APP_URL ?? "http://localhost:3000";
  return betterAuth({
    appName: "Loopchat",
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: {
      enabled: true,
      // Alta solo por invitación (Loop Smiths o tenant_admin): sin registro público.
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 30,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: "Restablecer tu contraseña de Loopchat",
          text: `Hola ${user.name},\n\nPara elegir una nueva contraseña abrí este enlace (vence en 30 minutos):\n${url}\n\nSi no lo pediste, ignorá este mensaje.\n\nLoopchat by Loop Smiths`,
        });
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: process.env.NODE_ENV === "production" || process.env.AUTH_RATE_LIMIT === "true",
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/request-password-reset": { window: 60, max: 4 },
      },
    },
    advanced: {
      cookiePrefix: "loopchat",
      useSecureCookies: baseURL.startsWith("https://"),
    },
    trustedOrigins: [baseURL],
    plugins: [nextCookies()],
  });
}

type AuthInstance = ReturnType<typeof createAuth>;
const g = globalThis as unknown as { __loopchatAuth?: AuthInstance };

export function getAuth(): AuthInstance {
  if (!g.__loopchatAuth) g.__loopchatAuth = createAuth();
  return g.__loopchatAuth;
}

/** Crea un usuario con contraseña (usado al aceptar invitaciones / bootstrap). */
export async function createPasswordUser(input: { email: string; name: string; password: string }) {
  const ctx = await getAuth().$context;
  if (input.password.length < 10) throw new Error("La contraseña debe tener al menos 10 caracteres");
  const hash = await ctx.password.hash(input.password);
  const created = await ctx.internalAdapter.createUser({
    email: input.email.toLowerCase(),
    name: input.name,
    emailVerified: true,
  }, { method: "email-password" });
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: hash,
  });
  return created;
}

export async function revokeAllSessions(userId: string) {
  const ctx = await getAuth().$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
}
