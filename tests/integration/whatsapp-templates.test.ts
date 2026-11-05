import { beforeAll, describe, expect, it } from "vitest";
import { sendOutbound } from "@/server/services/outbound";
import { listTemplates, sendTemplate, toTemplateView } from "@/server/services/templates";
import { addMember, ctxFor, twoTenants } from "../helpers/factory";
import { localConversation, provisionWithChannel, settle, simIncoming, simMessages, startWebhookRelay } from "../helpers/chatwoot";

beforeAll(async () => {
  await startWebhookRelay();
});

describe("plantillas de WhatsApp desde Loopchat (P1-13)", () => {
  it("fuera de la ventana: texto libre bloqueado; plantilla aprobada se envía por Chatwoot con parámetros por posición", async () => {
    const { A, ctxA, ctxB } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491160000101", name: "Lucía", content: "hola", ageSeconds: 30 * 3600 });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;

    await expect(sendOutbound(ctxA, { conversationId: conv.id, text: "¿Seguís interesada?", idempotencyKey: `free:${conv.id}` })).rejects.toMatchObject({ status: 422 });

    const { templates } = await listTemplates(ctxA, conv.id, { sync: true });
    expect(templates.map((t) => t.name).sort()).toEqual(["promo_con_imagen", "seguimiento_consulta"]); // PENDING excluida
    expect(templates.find((t) => t.name === "promo_con_imagen")?.available).toBe(false);
    const t = templates.find((x) => x.name === "seguimiento_consulta")!;
    expect(t.params).toBe(2);

    await expect(sendTemplate(ctxA, conv.id, { name: t.name, language: t.language, params: ["Lucía"], idempotencyKey: `tpl-${conv.id}-bad` })).rejects.toThrow(/2 dato/);
    await expect(sendTemplate(ctxA, conv.id, { name: "recordatorio_pago", language: "es_AR", params: ["x"], idempotencyKey: `tpl-${conv.id}-pend` })).rejects.toThrow(/aprobada/);
    await expect(sendTemplate(ctxA, conv.id, { name: t.name, language: t.language, params: ["Lucía", "línea\nnueva"], idempotencyKey: `tpl-${conv.id}-nl` })).rejects.toThrow();

    const res = await sendTemplate(ctxA, conv.id, { name: t.name, language: t.language, params: ["Lucía", "el taladro percutor"], idempotencyKey: `tpl-${conv.id}-ok` });
    expect(res.status).toBe("sent");
    const sent = (await simMessages(accountId, r.conversationId)).filter((m) => m.message_type === 3);
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toBe("Hola Lucía, te escribimos por tu consulta sobre el taladro percutor. ¿Seguimos por acá?");
    expect(sent[0].status).toBe("sent");
    // reintento con la misma clave: no duplica
    await sendTemplate(ctxA, conv.id, { name: t.name, language: t.language, params: ["Lucía", "el taladro percutor"], idempotencyKey: `tpl-${conv.id}-ok` });
    expect((await simMessages(accountId, r.conversationId)).filter((m) => m.message_type === 3)).toHaveLength(1);

    // aislamiento y permisos
    await expect(listTemplates(ctxB, conv.id)).rejects.toMatchObject({ status: 404 });
    const viewer = await addMember(A.id, "viewer");
    await expect(listTemplates(ctxFor(A.id, viewer, "viewer"), conv.id)).rejects.toMatchObject({ status: 403 });
  });

  it("parseo de plantillas: solo APPROVED; encabezado multimedia o botones con parámetros no disponibles", () => {
    expect(toTemplateView({ name: "x", language: "es", status: "REJECTED", components: [{ type: "BODY", text: "hola" }] })).toBeNull();
    expect(toTemplateView({ name: "x", language: "es", status: "approved", components: [{ type: "BODY", text: "hola {{1}} y {{2}}" }] })).toMatchObject({ params: 2, available: true });
    expect(toTemplateView({ name: "x", language: "es", status: "APPROVED", components: [{ type: "BODY", text: "hola" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://a.com/{{1}}" }] }] })?.available).toBe(false);
  });
});
