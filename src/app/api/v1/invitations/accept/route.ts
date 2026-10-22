import { getSessionUser } from "@/server/authz/context";
import { publicRoute, readJson } from "@/server/http/api";
import { acceptInvitation, acceptSchema } from "@/server/services/invitations";

export const POST = publicRoute(
  async ({ req }) => {
    const body = await readJson(req, acceptSchema);
    const user = await getSessionUser(req.headers);
    const res = await acceptInvitation(body, user);
    return { ok: true, createdUser: res.createdUser };
  },
  { rateLimit: { max: 10 } },
);
