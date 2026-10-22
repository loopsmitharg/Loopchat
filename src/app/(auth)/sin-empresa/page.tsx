import Link from "next/link";

export default function NoTenantPage() {
  return (
    <div>
      <h1 className="font-display text-[22px] font-semibold">Tu usuario no tiene una empresa activa</h1>
      <p className="mt-2 text-[13.5px] text-fg-muted">
        Puede que tu acceso haya sido deshabilitado o que la invitación todavía no se haya aceptado. Pedile a un administrador de tu empresa que te invite de nuevo.
      </p>
      <p className="mt-6">
        <Link href="/login" className="text-[13px] underline">
          Ingresar con otra cuenta
        </Link>
      </p>
    </div>
  );
}
