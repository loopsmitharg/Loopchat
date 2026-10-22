import { describe, expect, it } from "vitest";
import { can, PERMISSIONS } from "@/lib/permissions";

describe("matriz de permisos", () => {
  it("tenant_admin tiene todos los permisos", () => {
    for (const p of PERMISSIONS) expect(can("tenant_admin", p)).toBe(true);
  });
  it("viewer no puede mutar nada", () => {
    for (const p of PERMISSIONS) {
      if (/:(write|reply|note|assign|status|bot_control|publish|configure|manage)/.test(p)) expect(can("viewer", p)).toBe(false);
    }
  });
  it("agent no gestiona credenciales, miembros ni publica bots", () => {
    expect(can("agent", "credentials:manage")).toBe(false);
    expect(can("agent", "members:manage")).toBe(false);
    expect(can("agent", "bot:publish")).toBe(false);
    expect(can("agent", "conversation:assign_any")).toBe(false);
    expect(can("agent", "conversation:reply")).toBe(true);
  });
  it("manager configura pipeline pero no credenciales", () => {
    expect(can("manager", "pipeline:configure")).toBe(true);
    expect(can("manager", "credentials:manage")).toBe(false);
  });
});
