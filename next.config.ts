import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Loopchat es una app multiempresa con datos por request: todo se renderiza
  // dinámicamente y nunca se cachea entre usuarios (ver docs/decisions.md).
  cacheComponents: false,
  // No reescribir el AGENTS.md del proyecto (reglas propias de Loopchat).
  agentRules: false,
  poweredByHeader: false,
  // permite correr el servidor E2E en paralelo con el de desarrollo
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["pg", "unpdf", "nodemailer"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
