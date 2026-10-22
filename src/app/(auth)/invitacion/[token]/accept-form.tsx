"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function AcceptForm({ token, email, userExists, signedInAs }: { token: string; email: string; userExists: boolean; signedInAs: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function accept(body: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/v1/invitations/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, ...body }) });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setLoading(false);
      setError(json?.error?.message ?? "No se pudo aceptar la invitación.");
      return false;
    }
    return true;
  }

  if (userExists) {
    if (signedInAs?.toLowerCase() !== email.toLowerCase()) {
      return (
        <p className="mt-6 text-[13.5px]">
          Ya tenés una cuenta con ese email.{" "}
          <Link className="font-medium underline" href={`/login?next=/invitacion/${token}`}>
            Ingresá
          </Link>{" "}
          y volvé a abrir este enlace.
        </p>
      );
    }
    return (
      <div className="mt-6 flex flex-col gap-3">
        {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
        <Button
          variant="primary"
          loading={loading}
          onClick={async () => {
            if (await accept({})) {
              router.push("/dashboard");
              router.refresh();
            }
          }}
        >
          Aceptar invitación
        </Button>
      </div>
    );
  }

  return (
    <form method="post"
      className="mt-6 flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const password = String(fd.get("password") ?? "");
        if (password !== fd.get("confirm")) return setError("Las contraseñas no coinciden.");
        if (!(await accept({ name: fd.get("name"), password }))) return;
        const signIn = await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
        router.push(signIn.ok ? "/dashboard" : "/login");
        router.refresh();
      }}
    >
      <Field label="Tu nombre">{(p) => <Input {...p} name="name" autoComplete="name" required minLength={2} />}</Field>
      <Field label="Contraseña" hint="Mínimo 10 caracteres.">
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required minLength={10} />}
      </Field>
      <Field label="Repetir contraseña">{(p) => <Input {...p} name="confirm" type="password" autoComplete="new-password" required />}</Field>
      {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
      <Button type="submit" variant="primary" loading={loading}>
        Crear cuenta y entrar
      </Button>
    </form>
  );
}
