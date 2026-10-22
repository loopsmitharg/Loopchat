import { describe, expect, it } from "vitest";
import { createContact, getContact, listContacts, updateContact } from "@/server/services/contacts";
import { createOpportunity, getBoard, getOpportunityDetail, updateOpportunity } from "@/server/services/opportunities";
import { createPipeline, listPipelines, savePipelineStages } from "@/server/services/pipelines";
import { addMember, ctxFor, makeTenant, twoTenants } from "../helpers/factory";

describe("contactos", () => {
  it("normaliza teléfono E.164, evita duplicados y aísla por tenant", async () => {
    const { ctxA, ctxB } = await twoTenants();
    const c = await createContact(ctxA, { name: "Ana", phone: "011 15 2345-6789" });
    expect(c.phoneE164).toMatch(/^\+54/);
    await expect(createContact(ctxA, { name: "Ana 2", phone: c.phoneE164! })).rejects.toThrow(/Ya existe/);
    await createContact(ctxB, { name: "Ana en B", phone: c.phoneE164! }); // otra empresa: permitido, no se fusiona
    await expect(createContact(ctxA, { name: "Mal", phone: "123" })).rejects.toThrow(/inválido/);
    expect((await listContacts(ctxA, { q: "ana" })).items).toHaveLength(1);
    await expect(getContact(ctxB, c.id)).rejects.toThrow(/No encontrado/);
    await expect(updateContact(ctxB, c.id, { name: "hack" })).rejects.toThrow(/No encontrado/);
  });
});

describe("pipeline y oportunidades", () => {
  it("crea, mueve y persiste; ganado cierra; historial auditable", async () => {
    const { ctxA } = await twoTenants();
    const c = await createContact(ctxA, { name: "Hernán", phone: "+5491144445555" });
    const opp = await createOpportunity(ctxA, { contactId: c.id, title: "Compra de herramientas", amount: 120000 });
    const board = await getBoard(ctxA);
    const won = board.stages.find((s) => s.kind === "won")!;
    const second = board.stages[1];
    const moved = await updateOpportunity(ctxA, opp.id, { expectedVersion: opp.version, stageId: second.id });
    const closed = await updateOpportunity(ctxA, opp.id, { expectedVersion: moved.version, stageId: won.id });
    expect(closed.status).toBe("won");
    expect(closed.closedAt).toBeTruthy();
    const detail = await getOpportunityDetail(ctxA, opp.id);
    expect(detail.history.map((h) => h.field)).toEqual(expect.arrayContaining(["created", "stage", "status"]));
    const again = await getBoard(ctxA);
    expect(again.opportunities.find((o) => o.id === opp.id)?.stageId).toBe(won.id);
  });

  it("edición concurrente: la segunda escritura con versión vieja recibe conflicto (sin pérdida silenciosa)", async () => {
    const { ctxA, ctxAgentA } = await twoTenants();
    const c = await createContact(ctxA, { name: "Concurrencia", phone: "+5491155556666" });
    const opp = await createOpportunity(ctxA, { contactId: c.id, title: "Original" });
    await updateOpportunity(ctxA, opp.id, { expectedVersion: opp.version, title: "Editado por admin" });
    await expect(updateOpportunity(ctxAgentA, opp.id, { expectedVersion: opp.version, title: "Editado por agente" })).rejects.toThrow(/Otra persona/);
    const d = await getOpportunityDetail(ctxA, opp.id);
    expect(d.opportunity.title).toBe("Editado por admin");
  });

  it("dos movimientos simultáneos con la misma versión: solo uno gana", async () => {
    const { ctxA } = await twoTenants();
    const c = await createContact(ctxA, { name: "Race", phone: "+5491155557777" });
    const opp = await createOpportunity(ctxA, { contactId: c.id, title: "Race" });
    const b = await getBoard(ctxA);
    const results = await Promise.allSettled([
      updateOpportunity(ctxA, opp.id, { expectedVersion: opp.version, stageId: b.stages[1].id }),
      updateOpportunity(ctxA, opp.id, { expectedVersion: opp.version, stageId: b.stages[2].id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("configurar etapas de una empresa no altera otra; reglas de etapas; roles insuficientes no mutan", async () => {
    const { A, ctxA, ctxB } = await twoTenants();
    const [pa] = await listPipelines(ctxA);
    const [pb] = await listPipelines(ctxB);
    type StageIn = { id?: string; name: string; kind: "open" | "won" | "lost" };
    await savePipelineStages(ctxA, pa.id, {
      name: "Ventas mayoristas",
      stages: [
        { id: pa.stages[0].id, name: "Lead", kind: "open" },
        { name: "Negociación", kind: "open" },
        { id: pa.stages.find((s) => s.kind === "won")!.id, name: "Cerrado", kind: "won" },
        { id: pa.stages.find((s) => s.kind === "lost")!.id, name: "Descartado", kind: "lost" },
        ...pa.stages.slice(1).filter((s) => s.kind === "open").map((s): StageIn => ({ id: s.id, name: s.name, kind: "open" })),
      ] satisfies StageIn[],
    });
    const [pb2] = await listPipelines(ctxB);
    expect(pb2.stages.map((s) => s.name)).toEqual(pb.stages.map((s) => s.name));
    await expect(savePipelineStages(ctxA, pa.id, { name: "x1", stages: [{ name: "a", kind: "won" }, { name: "b", kind: "open" }, { name: "c", kind: "lost" }] })).rejects.toThrow(/primera etapa/);
    await expect(savePipelineStages(ctxB, pa.id, { name: "hack", stages: [{ name: "a", kind: "open" }, { name: "b", kind: "won" }, { name: "c", kind: "lost" }] })).rejects.toThrow(/No encontrado/);
    const viewer = await addMember(A.id, "viewer");
    const vctx = ctxFor(A.id, viewer, "viewer");
    const c = await createContact(ctxA, { name: "V", phone: "+5491155558888" });
    await expect(createOpportunity(vctx, { contactId: c.id, title: "No debería" })).rejects.toThrow(/permiso/);
    const agent = await addMember(A.id, "agent");
    await expect(createPipeline(ctxFor(A.id, agent, "agent"), { name: "Nuevo" })).rejects.toThrow(/permiso/);
  });

  it("límite de pipelines del plan Starter", async () => {
    const t = await makeTenant("starter");
    const admin = await addMember(t.id, "tenant_admin");
    await expect(createPipeline(ctxFor(t.id, admin, "tenant_admin"), { name: "Segundo" })).rejects.toThrow(/máximo de pipelines/);
  });

  it("no se puede asociar contacto, etapa ni responsable de otra empresa", async () => {
    const { ctxA, ctxB, adminB } = await twoTenants();
    const cA = await createContact(ctxA, { name: "Solo A", phone: "+5491155559999" });
    await expect(createOpportunity(ctxB, { contactId: cA.id, title: "Robo" })).rejects.toThrow(/Contacto inexistente/);
    const boardB = await getBoard(ctxB);
    await expect(createOpportunity(ctxA, { contactId: cA.id, title: "x2", stageId: boardB.stages[0].id })).rejects.toThrow(/Etapa inexistente/);
    await expect(createOpportunity(ctxA, { contactId: cA.id, title: "x3", ownerUserId: adminB.id })).rejects.toThrow(/miembro activo/);
  });
});
