"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export default function RequestResetPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <h1 className="font-display text-[24px] font-semibold tracking-tight">Restablecer contraseña</h1>
      {sent ? (
        <p role="status" className="mt-4 rounded-md border border-border bg-surface px-3 py-3 text-[13.5px]">
          Si el email pertenece a una cuenta, vas a recibir un enlace para elegir una nueva contraseña. Vence en 30 minutos.
        </p>
      ) : (
        <form method="post"
          className="mt-6 flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            setError(null);
            const email = new FormData(e.currentTarget).get("email");
            const res = await fetch("/api/auth/request-password-reset", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email, redirectTo: "/restablecer/nueva" }),
            });
            setLoading(false);
            if (res.status === 429) return setError("Demasiados intentos. Esperá un minuto.");
            setSent(true);
          }}
        >
          <Field label="Email">{(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}</Field>
          {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
          <Button type="submit" variant="primary" loading={loading}>
            Enviar enlace
          </Button>
        </form>
      )}
      <Link href="/login" className="mt-4 block text-center text-[13px] text-fg-secondary underline underline-offset-2">
        Volver a ingresar
      </Link>
    </div>
  );
}
