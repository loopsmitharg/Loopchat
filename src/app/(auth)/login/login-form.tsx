"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Señal de interactividad: evita enviar el formulario antes de que React lo controle.
  useEffect(() => {
    const t = setTimeout(() => setHydrated(true), 0);
    return () => clearTimeout(t);
  }, []);
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
      });
      if (res.status === 429) throw new Error("Demasiados intentos. Esperá un minuto y volvé a probar.");
      if (!res.ok) throw new Error("Email o contraseña incorrectos.");
      router.push(safeNext);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-[24px] font-semibold tracking-tight">Ingresar</h1>
      <p className="mt-1 text-[13.5px] text-fg-muted">Accedé con el email con el que te invitaron.</p>
      <form method="post" onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate data-ready={hydrated ? "true" : undefined}>
        <Field label="Email">{(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}</Field>
        <Field label="Contraseña">{(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}</Field>
        {error ? (
          <p role="alert" className="rounded-md border border-[#fecdca] bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" loading={loading} disabled={!hydrated}>
          Ingresar
        </Button>
        <Link href="/restablecer" className="text-center text-[13px] text-fg-secondary underline underline-offset-2 hover:text-fg">
          Olvidé mi contraseña
        </Link>
      </form>
    </div>
  );
}
