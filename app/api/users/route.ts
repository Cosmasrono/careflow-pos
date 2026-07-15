// Admin-only user management. Middleware already restricts /api/users to the
// admin role; we re-check here as defense in depth.
import { NextResponse } from "next/server";
import * as repo from "@/lib/server/clinic-repo";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/roles";
import {
  mailConfigured,
  sendAccountSetupEmail,
} from "@/lib/server/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureCanManageUsers() {
  const session = await getSession();
  return session && hasPermission(session.role, "users.manage") ? session : null;
}

export async function GET() {
  if (!(await ensureCanManageUsers())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ users: await repo.listUsers() });
}

export async function POST(req: Request) {
  if (!(await ensureCanManageUsers())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json();
  const result = await repo.createUser(body);
  if ("error" in result) {
    return NextResponse.json(result, { status: 400 });
  }

  let warning: string | undefined;
  if (result.user.email) {
    if (!mailConfigured()) {
      warning =
        "User was created, but email is not configured, so no password setup link was sent.";
    } else {
      try {
        const reset = await repo.createPasswordReset(result.user.email);
        if (reset) {
          const link = new URL(
            `/reset-password?token=${reset.token}`,
            process.env.APP_URL ?? new URL(req.url).origin,
          ).toString();
          await sendAccountSetupEmail({
            to: reset.to,
            name: reset.name,
            link,
          });
        }
      } catch (err) {
        console.error("account setup email failed", err);
        warning =
          "User was created, but we could not send the password setup email.";
      }
    }
  }

  return NextResponse.json({ users: await repo.listUsers(), warning });
}

export async function PATCH(req: Request) {
  if (!(await ensureCanManageUsers())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json();
  const result = await repo.updateUser(body);
  if ("error" in result) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json({ users: await repo.listUsers() });
}
