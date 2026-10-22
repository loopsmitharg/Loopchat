"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

function NewPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token");
  const tokenError = params.get("error");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(tokenError ? "El enlace es inválido o venció. Pedí uno nuevo." : null);
  const [loading, setLoading] = useState(false);
  if (done) {
    return (
      <p role="status" className="mt-4 text-[13.5px]">
        Contraseña actualizada. Cerramos tus otras sesiones por seguridad.{" "}
        <Link href="/login" className="font-medium underline">
          Ingresar
        </Link>
      </p>
    );
  }
  return (
    <form method="post"
      className="mt-6 flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const pw = String(fd.get("password") ?? "");
        if (pw.length < 10) return setError("Usá al menos 10 caracteres.");
        if (pw !== fd.get("confirm")) return setError("Las contraseñas no coinciden.");
        setLoading(true);
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, newPassword: pw }),
        });
        setLoading(false);
        if (!res.ok) return setError("El enlace es inválido o venció. Pedí uno nuevo.");
        setDone(true);
      }}
    >
      <Field label="Nueva contraseña" hint="Mínimo 10 caracteres.">
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required minLength={10} />}
      </Field>
      <Field label="Repetir contraseña">{(p) => <Input {...p} name="confirm" type="password" autoComplete="new-password" required />}</Field>
      {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
      <Button type="submit" variant="primary" loading={loading} disabled={!token}>
        Guardar contraseña
      </Button>
    </form>
  );
}

export default function NewPasswordPage() {
  return (
    <div>
      <h1 className="font-display text-[24px] font-semibold tracking-tight">Nueva contraseña</h1>
      <Suspense>
        <NewPasswordForm />
      </Suspense>
    </div>
  );
}
