// REST boundary between the browser and MongoDB.
//   GET  /api/clinic        → the whole dataset (doctors, patients, visits, orders)
//   POST /api/clinic        → { action, payload }, performs the mutation and
//                             returns the fresh dataset so the client stays in sync.

import { NextResponse } from "next/server";
import * as repo from "@/lib/server/clinic-repo";
import { getSession } from "@/lib/auth/session";
import { hasPermission, type Permission } from "@/lib/auth/roles";

// Prisma needs the Node.js runtime, and reads must never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const data = await repo.getClinicData();
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/clinic failed", err);
    return NextResponse.json({ error: "Failed to load data" }, { status: 500 });
  }
}

// Which permission is required for each mutation. This keeps route policies
// centralized and decoupled from literal role names.
const ACTION_PERMISSIONS: Record<string, Permission> = {
  registerPatient: "clinic.reception.manage",
  startVisit: "clinic.reception.manage",
  recordTriage: "clinic.reception.manage",
  assignVisitDoctor: "clinic.doctor.manage",
  startConsult: "clinic.doctor.manage",
  setVisitComplaint: "clinic.doctor.manage",
  addServiceOrder: "clinic.doctor.manage",
  addPrescription: "clinic.doctor.manage",
  startServiceOrder: "clinic.services.manage",
  completeServiceOrder: "clinic.services.manage",
  sendToPharmacy: "clinic.doctor.manage",
  toggleMedDispensed: "clinic.pharmacy.manage",
  dispenseAndClose: "clinic.pharmacy.manage",
  checkoutVisit: "clinic.pharmacy.manage",
  addMedicine: "clinic.medicine.manage",
  updateMedicine: "clinic.medicine.manage",
};

// Map each action name to its repository handler.
const handlers: Record<string, (payload: unknown) => Promise<unknown>> = {
  registerPatient: (p) => repo.registerPatient(p as never),
  startVisit: (p) => repo.startVisit(p as never),
  recordTriage: (p) => repo.recordTriage(p as never),
  assignVisitDoctor: (p) => repo.assignVisitDoctor(p as never),
  startConsult: (p) => repo.startConsult(p as never),
  setVisitComplaint: (p) => repo.setVisitComplaint(p as never),
  addServiceOrder: (p) => repo.addServiceOrder(p as never),
  addPrescription: (p) => repo.addPrescription(p as never),
  startServiceOrder: (p) => repo.startServiceOrder(p as never),
  completeServiceOrder: (p) => repo.completeServiceOrder(p as never),
  sendToPharmacy: (p) => repo.sendToPharmacy(p as never),
  toggleMedDispensed: (p) => repo.toggleMedDispensed(p as never),
  dispenseAndClose: (p) => repo.dispenseAndClose(p as never),
  checkoutVisit: (p) => repo.checkoutVisit(p as never),
  addMedicine: (p) => repo.addMedicine(p as never),
  updateMedicine: (p) => repo.updateMedicine(p as never),
};

export async function POST(req: Request) {
  try {
    const { action, payload } = await req.json();
    const handler = handlers[action];
    if (!handler) {
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 },
      );
    }
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const actionPermission = ACTION_PERMISSIONS[action];
    const allowed =
      hasPermission(session.role, "clinic.mutate.all") ||
      (actionPermission && hasPermission(session.role, actionPermission));
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Registrations are stamped with the logged-in user server-side, so a
    // client can never claim someone else onboarded the patient.
    const input =
      action === "registerPatient"
        ? { ...payload, registeredById: session.id }
        : payload;
    const result = await handler(input);
    // A rejected mutation (e.g. doctor already busy) reports { error }.
    if (result && typeof result === "object" && "error" in result) {
      return NextResponse.json(result, { status: 409 });
    }
    const data = await repo.getClinicData();
    return NextResponse.json(data);
  } catch (err) {
    console.error("POST /api/clinic failed", err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
