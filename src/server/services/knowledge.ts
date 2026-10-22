import "server-only";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { knowledgeChunks, knowledgeSources } from "../db/schema";
import { sha256 } from "../crypto/vault";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { badRequest, notFound } from "../http/errors";
import { log } from "../log";
import { audit } from "./audit";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = [".txt", ".md", ".pdf"] as const;
const MIN_TEXT_CHARS = 20;

export function chunkText(text: string, size = 900): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const paras = clean.split(/\n\n/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > size && cur) {
      chunks.push(cur.trim());
      cur = "";
    }
    if (p.length > size) {
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size).trim());
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.slice(0, 2000);
}

async function storeChunks(tenantId: string, sourceId: string, text: string) {
  const chunks = chunkText(text);
  if (chunks.length) await db.insert(knowledgeChunks).values(chunks.map((content, ordinal) => ({ tenantId, sourceId, ordinal, content })));
  return chunks.length;
}

export const faqSchema = z.object({ question: z.string().trim().min(3).max(500), answer: z.string().trim().min(1).max(4000) });
export const textSourceSchema = z.object({ title: z.string().trim().min(2).max(120), content: z.string().trim().min(MIN_TEXT_CHARS).max(200_000) });

export async function addFaq(ctx: Ctx, input: z.input<typeof faqSchema>) {
  assertCan(ctx, "knowledge:write");
  const d = faqSchema.parse(input);
  const content = `Pregunta: ${d.question}\nRespuesta: ${d.answer}`;
  const [s] = await db.insert(knowledgeSources).values({ tenantId: ctx.tenantId, kind: "faq", title: d.question, status: "ready", charCount: content.length, createdBy: actorUserId(ctx) }).returning();
  await db.insert(knowledgeChunks).values({ tenantId: ctx.tenantId, sourceId: s.id, ordinal: 0, content });
  return s;
}

export async function addTextSource(ctx: Ctx, input: z.input<typeof textSourceSchema>) {
  assertCan(ctx, "knowledge:write");
  const d = textSourceSchema.parse(input);
  const [s] = await db.insert(knowledgeSources).values({ tenantId: ctx.tenantId, kind: "text", title: d.title, status: "ready", charCount: d.content.length, createdBy: actorUserId(ctx) }).returning();
  await storeChunks(ctx.tenantId, s.id, d.content);
  return s;
}

function isLikelyUtf8Text(buf: Buffer) {
  if (buf.includes(0)) return false;
  const text = buf.toString("utf8");
  const replacement = (text.match(/�/g) ?? []).length;
  return replacement <= Math.max(2, text.length * 0.001);
}

/** Extrae texto de forma verificable. Nunca afirma haber leído un archivo si falló. */
export async function extractText(fileName: string, buf: Buffer): Promise<{ ok: true; text: string; mime: string } | { ok: false; error: string; mime: string }> {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") {
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return { ok: false, error: "El archivo no es un PDF válido.", mime: "application/pdf" };
    try {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(new Uint8Array(buf));
      if (doc.numPages > 300) return { ok: false, error: "El PDF supera las 300 páginas.", mime: "application/pdf" };
      const { text } = await pdfText(doc, { mergePages: true });
      const t = String(text ?? "").trim();
      if (t.replace(/\s/g, "").length < MIN_TEXT_CHARS) {
        return { ok: false, error: "El PDF no tiene texto extraíble (probablemente es una imagen escaneada). Loopchat no hace OCR: subí un PDF con texto o pegá el contenido.", mime: "application/pdf" };
      }
      return { ok: true, text: t, mime: "application/pdf" };
    } catch (e) {
      log.warn("knowledge.pdf_extract_failed", { err: e });
      return { ok: false, error: "No se pudo leer el PDF (dañado o protegido).", mime: "application/pdf" };
    }
  }
  if (ext === ".txt" || ext === ".md") {
    const mime = ext === ".md" ? "text/markdown" : "text/plain";
    if (!isLikelyUtf8Text(buf)) return { ok: false, error: "El archivo no es texto UTF-8 válido.", mime };
    const t = buf.toString("utf8").replace(/^﻿/, "").trim();
    if (t.replace(/\s/g, "").length < MIN_TEXT_CHARS) return { ok: false, error: "El archivo no tiene contenido suficiente.", mime };
    return { ok: true, text: t, mime };
  }
  return { ok: false, error: "Formato no admitido. Usá TXT, MD o PDF con texto.", mime: "application/octet-stream" };
}

export function storageRoot() {
  // ruta configurable en runtime (volumen persistente); no debe incluirse en el bundle
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.STORAGE_DIR ?? "./storage");
}

export async function uploadKnowledgeFile(ctx: Ctx, file: { name: string; bytes: Buffer }) {
  assertCan(ctx, "knowledge:write");
  const name = path.basename(file.name).replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, "_").slice(0, 120);
  const ext = path.extname(name).toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) throw badRequest("Formato no admitido. Usá TXT, MD o PDF con texto.");
  if (file.bytes.length === 0) throw badRequest("El archivo está vacío.");
  if (file.bytes.length > MAX_FILE_BYTES) throw badRequest("El archivo supera los 5 MB.");
  const extracted = await extractText(name, file.bytes);
  const [s] = await db
    .insert(knowledgeSources)
    .values({
      tenantId: ctx.tenantId,
      kind: "file",
      title: name,
      status: extracted.ok ? "ready" : "failed",
      error: extracted.ok ? null : extracted.error,
      fileName: name,
      mimeType: extracted.mime,
      sizeBytes: file.bytes.length,
      sha256: sha256(file.bytes),
      charCount: extracted.ok ? extracted.text.length : 0,
      createdBy: actorUserId(ctx),
    })
    .returning();
  if (extracted.ok) {
    // almacenamiento segregado por tenant; el nombre en disco no depende del usuario
    const dir = path.join(storageRoot(), "knowledge", ctx.tenantId);
    await mkdir(dir, { recursive: true });
    const storagePath = path.join(dir, `${s.id}${ext}`);
    await writeFile(storagePath, file.bytes, { mode: 0o600 });
    await db.update(knowledgeSources).set({ storagePath }).where(eq(knowledgeSources.id, s.id));
    await storeChunks(ctx.tenantId, s.id, extracted.text);
  }
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "knowledge.uploaded", targetType: "knowledge_source", targetId: s.id, data: { name, ok: extracted.ok } });
  return { ...s, status: extracted.ok ? "ready" : "failed", error: extracted.ok ? null : extracted.error };
}

export async function listKnowledge(ctx: Ctx) {
  assertCan(ctx, "knowledge:read");
  return db
    .select({ id: knowledgeSources.id, kind: knowledgeSources.kind, title: knowledgeSources.title, status: knowledgeSources.status, error: knowledgeSources.error, sizeBytes: knowledgeSources.sizeBytes, charCount: knowledgeSources.charCount, createdAt: knowledgeSources.createdAt })
    .from(knowledgeSources)
    .where(eq(knowledgeSources.tenantId, ctx.tenantId))
    .orderBy(desc(knowledgeSources.createdAt));
}

export async function deleteKnowledge(ctx: Ctx, id: string) {
  assertCan(ctx, "knowledge:write");
  const s = await db.query.knowledgeSources.findFirst({ where: and(eq(knowledgeSources.id, id), eq(knowledgeSources.tenantId, ctx.tenantId)) });
  if (!s) throw notFound();
  await db.delete(knowledgeSources).where(eq(knowledgeSources.id, s.id));
  if (s.storagePath && s.storagePath.startsWith(storageRoot())) await unlink(s.storagePath).catch(() => undefined);
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "knowledge.deleted", targetType: "knowledge_source", targetId: id });
}

/** Búsqueda textual simple (full-text en español) acotada SIEMPRE al tenant. */
/** sourceIds: restringe a las fuentes autorizadas para el bot (null = todas las de la empresa). */
export async function searchKnowledge(tenantId: string, query: string, limit = 4, sourceIds: string[] | null = null) {
  const q = query.trim().slice(0, 300);
  if (!q) return [];
  if (sourceIds && !sourceIds.length) return [];
  const only = sourceIds ? sql` and s.id in ${sourceIds}` : sql``;
  const res = await db.execute<{ content: string; title: string; rank: number }>(sql`
    select c.content, s.title, ts_rank(c.tsv, websearch_to_tsquery('spanish', ${q})) as rank
    from knowledge_chunks c join knowledge_sources s on s.id = c.source_id
    where c.tenant_id = ${tenantId} and s.status = 'ready' and c.tsv @@ websearch_to_tsquery('spanish', ${q})${only}
    order by rank desc limit ${limit}`);
  if (res.rows.length > 0) return res.rows.map((r) => ({ title: r.title, content: r.content }));
  // fallback: cualquier término (OR) para consultas coloquiales
  const terms = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 3)
    .slice(0, 8);
  if (terms.length === 0) return [];
  const orQuery = terms.join(" | ");
  const res2 = await db.execute<{ content: string; title: string }>(sql`
    select c.content, s.title from knowledge_chunks c join knowledge_sources s on s.id = c.source_id
    where c.tenant_id = ${tenantId} and s.status = 'ready' and c.tsv @@ to_tsquery('spanish', ${orQuery})${only}
    order by ts_rank(c.tsv, to_tsquery('spanish', ${orQuery})) desc limit ${limit}`);
  return res2.rows.map((r) => ({ title: r.title, content: r.content }));
}
