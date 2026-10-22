import { headers } from "next/headers";
import { getSessionUser } from "@/server/authz/context";
import { describeInvitation } from "@/server/services/invitations";
import { ROLE_LABELS } from "@/lib/permissions";
import { AcceptForm } from "./accept-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invitación" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let info: Awaited<ReturnType<typeof describeInvitation>> | null = null;
  try {
    info = await describeInvitation(token);
  } catch {
    info = null;
  }
  if (!info) {
    return (
      <div>
        <h1 className="font-display text-[22px] font-semibold">Invitación inválida o vencida</h1>
        <p className="mt-2 text-[13.5px] text-fg-muted">Pedile a quien te invitó que genere una nueva invitación.</p>
      </div>
    );
  }
  const sessionUser = await getSessionUser(await headers());
  return (
    <div>
      <h1 className="font-display text-[22px] font-semibold tracking-tight">Sumate a {info.tenantName}</h1>
      <p className="mt-1 text-[13.5px] text-fg-muted">
        Invitación para <strong className="text-fg">{info.email}</strong> como {ROLE_LABELS[info.role]}.
      </p>
      <AcceptForm token={token} email={info.email} userExists={info.userExists} signedInAs={sessionUser?.email ?? null} />
    </div>
  );
}
