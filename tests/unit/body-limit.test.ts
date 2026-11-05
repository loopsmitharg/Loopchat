import { describe, expect, it } from "vitest";
import { readBodyLimited, readFormLimited } from "@/server/http/api";

/** Stream "chunked" de `total` bytes que cuenta cuántos bytes se le pidieron. */
function chunkedRequest(total: number, chunk = 64 * 1024) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= total) return c.close();
      const n = Math.min(chunk, total - sent);
      sent += n;
      c.enqueue(new Uint8Array(n).fill(97));
    },
  });
  // sin Content-Length, como un envío chunked
  const req = { headers: new Headers(), body } as unknown as Request;
  return { req, pulled: () => sent };
}

describe("límite de cuerpos HTTP (regresión SEC-03)", () => {
  it("50 MB chunked → 413 sin leer más que el tope", async () => {
    const { req, pulled } = chunkedRequest(50 * 1024 * 1024);
    await expect(readBodyLimited(req, 512 * 1024)).rejects.toMatchObject({ status: 413 });
    expect(pulled()).toBeLessThan(600 * 1024 + 2 * 64 * 1024);
  });
  it("Content-Length declarado mayor al tope → 413 sin leer", async () => {
    const req = new Request("http://x/api", { method: "POST", headers: { "content-length": String(10 * 1024 * 1024) }, body: "x" });
    await expect(readBodyLimited(req, 1024)).rejects.toMatchObject({ status: 413 });
  });
  it("cuerpos válidos se leen completos", async () => {
    const { req } = chunkedRequest(300 * 1024);
    expect((await readBodyLimited(req, 512 * 1024)).length).toBe(300 * 1024);
  });
  it("multipart acotado", async () => {
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array(2048)], "a.txt"));
    const ok = new Request("http://x", { method: "POST", body: fd });
    expect(((await readFormLimited(ok, 10_000)).get("file") as File).size).toBe(2048);
    const big = new FormData();
    big.set("file", new File([new Uint8Array(20_000)], "a.txt"));
    const raw = new Response(big);
    const bytes = new Uint8Array(await raw.arrayBuffer());
    const stream = new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(bytes), c.close()) });
    const req = { headers: new Headers({ "content-type": raw.headers.get("content-type")! }), body: stream } as unknown as Request;
    await expect(readFormLimited(req, 10_000)).rejects.toMatchObject({ status: 413 });
  });
});
