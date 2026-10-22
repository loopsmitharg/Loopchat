import { describe, expect, it } from "vitest";
import { addFaq, addTextSource, deleteKnowledge, listKnowledge, searchKnowledge, uploadKnowledgeFile } from "@/server/services/knowledge";
import { createTask, listTasks, setTaskStatus } from "@/server/services/tasks";
import { createContact } from "@/server/services/contacts";
import { addMember, ctxFor, twoTenants } from "../helpers/factory";
import { makePdf } from "../helpers/pdf";

describe("conocimiento documental", () => {
  it("TXT/MD válidos se incorporan y se buscan solo dentro del tenant", async () => {
    const { ctxA, ctxB, A, B } = await twoTenants();
    const s = await uploadKnowledgeFile(ctxA, { name: "politicas.md", bytes: Buffer.from("# Garantía\n\nTodas las herramientas eléctricas tienen garantía de 12 meses con el ticket de compra.") });
    expect(s.status).toBe("ready");
    await addTextSource(ctxB, { title: "Interno B", content: "La garantía de B es de 3 meses, información confidencial." });
    const resA = await searchKnowledge(A.id, "cuánto dura la garantía de las herramientas");
    expect(resA[0].content).toContain("12 meses");
    expect(resA.some((r) => r.content.includes("3 meses"))).toBe(false);
    const resB = await searchKnowledge(B.id, "garantía");
    expect(resB.every((r) => !r.content.includes("12 meses"))).toBe(true);
    await expect(deleteKnowledge(ctxB, s.id)).rejects.toThrow(/No encontrado/);
  });

  it("PDF con texto se extrae; PDF sin texto (imagen) falla explícitamente; formatos/tamaños inválidos se rechazan", async () => {
    const { ctxA, A } = await twoTenants();
    const ok = await uploadKnowledgeFile(ctxA, { name: "lista.pdf", bytes: makePdf("Lista de precios: amoladora angular 4500 W precio especial") });
    expect(ok.status).toBe("ready");
    expect((await searchKnowledge(A.id, "amoladora"))[0].content).toMatch(/amoladora/i);
    const scanned = await uploadKnowledgeFile(ctxA, { name: "escaneo.pdf", bytes: makePdf(null) });
    expect(scanned.status).toBe("failed");
    expect(scanned.error).toMatch(/no tiene texto extraíble/);
    const fake = await uploadKnowledgeFile(ctxA, { name: "falso.pdf", bytes: Buffer.from("MZ\x90\x00 esto es un ejecutable") });
    expect(fake.status).toBe("failed");
    await expect(uploadKnowledgeFile(ctxA, { name: "virus.exe", bytes: Buffer.from("MZ...") })).rejects.toThrow(/Formato no admitido/);
    await expect(uploadKnowledgeFile(ctxA, { name: "grande.txt", bytes: Buffer.alloc(6 * 1024 * 1024, 97) })).rejects.toThrow(/5 MB/);
    await expect(uploadKnowledgeFile(ctxA, { name: "binario.txt", bytes: Buffer.from([0, 1, 2, 3, 0, 255, 254, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) })).resolves.toMatchObject({ status: "failed" });
    await expect(uploadKnowledgeFile(ctxA, { name: "../../etc/passwd.txt", bytes: Buffer.from("contenido de prueba suficientemente largo para indexar") })).resolves.toMatchObject({ title: "passwd.txt" });
    const list = await listKnowledge(ctxA);
    expect(list.filter((x) => x.status === "failed").length).toBeGreaterThanOrEqual(3);
  });

  it("viewer no puede cargar conocimiento", async () => {
    const { A } = await twoTenants();
    const v = await addMember(A.id, "viewer");
    await expect(addFaq(ctxFor(A.id, v, "viewer"), { question: "¿Horario?", answer: "9 a 18" })).rejects.toThrow(/permiso/);
  });
});

describe("tareas", () => {
  it("se crean con responsable/vencimiento, se completan y respetan ACL de tenant", async () => {
    const { ctxA, ctxB, agentA } = await twoTenants();
    const c = await createContact(ctxA, { name: "Cliente Tarea", phone: "+5491133334444" });
    const t = await createTask(ctxA, { title: "Llamar para confirmar pedido", contactId: c.id, assigneeUserId: agentA.id, dueAt: new Date(Date.now() + 3600_000) });
    expect((await listTasks(ctxA)).map((x) => x.id)).toContain(t.id);
    await expect(setTaskStatus(ctxB, t.id, "done")).rejects.toThrow(/No encontrado/);
    await expect(createTask(ctxB, { title: "intruso", contactId: c.id })).rejects.toThrow(/No encontrado/);
    await setTaskStatus(ctxA, t.id, "done");
    expect((await listTasks(ctxA, { status: "done" }))[0].completedAt).toBeTruthy();
    expect(await listTasks(ctxB)).toHaveLength(0);
  });
});
