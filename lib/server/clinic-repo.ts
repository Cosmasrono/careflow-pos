

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/auth/roles";
import { generateTempPassword, hashPassword } from "@/lib/auth/password";
import { mpesaConfigured } from "@/lib/server/mpesa";
import type {
  BillingMode,
  ChargeType,
  ClinicData,
  ClinicSettings,
  Doctor,
  Expense,
  ExpenseCategory,
  Gender,
  ID,
  LabParameter,
  LabResult,
  Med,
  Medicine,
  Order,
  OrderStatus,
  OrderType,
  Patient,
  Payment,
  PaymentMethod,
  Priority,
  ServiceItem,
  Visit,
  VisitStatus,
  Vitals,
} from "@/lib/types";

// --- row → domain mappers --------------------------------------------------

type PatientRow = Awaited<ReturnType<typeof prisma.patient.findFirstOrThrow>>;
type VisitRow = Awaited<ReturnType<typeof prisma.visit.findFirstOrThrow>>;
type OrderRow = Awaited<ReturnType<typeof prisma.order.findFirstOrThrow>>;
type UserRow = Awaited<ReturnType<typeof prisma.user.findFirstOrThrow>>;
type MedicineRow = Awaited<ReturnType<typeof prisma.medicine.findFirstOrThrow>>;

// The "doctor roster" reception assigns to is just the active doctor users.
function mapDoctor(u: UserRow): Doctor {
  return { id: u.id, name: u.name };
}

function mapPatient(p: PatientRow): Patient {
  return {
    id: p.id,
    mrn: p.mrn,
    nationalId: p.nationalId,
    firstName: p.firstName,
    lastName: p.lastName,
    gender: p.gender as Gender,
    age: p.age,
    phone: p.phone,
    registeredById: p.registeredById ?? undefined,
    createdAt: p.createdAt.toISOString(),
  };
}

function mapVisit(v: VisitRow): Visit {
  return {
    id: v.id,
    patientId: v.patientId,
    vitals: v.vitals as Vitals,
    priority: (v.priority ?? undefined) as Priority | undefined,
    complaint: v.complaint,
    assignedDoctorId: v.assignedDoctorId ?? undefined,
    status: v.status as VisitStatus,
    billingMode: v.billingMode as BillingMode,
    charges: v.charges.map((c) => ({
      id: c.id,
      type: c.type as ChargeType,
      description: c.description,
      amount: c.amount,
      paid: c.paid,
      paidAt: c.paidAt ? c.paidAt.toISOString() : undefined,
      paymentId: c.paymentId ?? undefined,
      createdAt: c.createdAt.toISOString(),
    })),
    payments: v.payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method as PaymentMethod,
      reference: p.reference ?? undefined,
      paidAt: p.paidAt.toISOString(),
      covers: p.covers,
      takenBy: p.takenBy ?? undefined,
    })),
    payment: v.payment
      ? {
          amount: v.payment.amount,
          method: v.payment.method as PaymentMethod,
          reference: v.payment.reference ?? undefined,
          paidAt: v.payment.paidAt.toISOString(),
        }
      : undefined,
    saleItems: v.saleItems.length > 0 ? v.saleItems : undefined,
    timeline: v.timeline.map((e) => ({
      status: e.status as VisitStatus,
      at: e.at.toISOString(),
    })),
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

/** Prisma fragment: append "the visit just entered this status" to the
 *  timeline, so the journey from reception to completed is timestamped. */
function stage(status: VisitStatus) {
  return { push: { status, at: new Date() } };
}

function mapMedicine(m: MedicineRow): Medicine {
  return {
    id: m.id,
    name: m.name,
    strength: m.strength,
    form: m.form,
    unitPrice: m.unitPrice,
    costPrice: m.costPrice,
    stock: m.stock,
  };
}

type ExpenseRow = Awaited<ReturnType<typeof prisma.expense.findFirstOrThrow>>;

function mapExpense(e: ExpenseRow): Expense {
  return {
    id: e.id,
    description: e.description,
    category: e.category as ExpenseCategory,
    amount: e.amount,
    date: e.date.toISOString(),
    recordedBy: e.recordedBy ?? undefined,
    createdAt: e.createdAt.toISOString(),
  };
}

function mapOrder(o: OrderRow): Order {
  return {
    id: o.id,
    visitId: o.visitId,
    type: o.type as OrderType,
    title: o.title,
    instructions: o.instructions ?? undefined,
    status: o.status as OrderStatus,
    serviceItemId: o.serviceItemId ?? undefined,
    results: o.results.length > 0
      ? o.results.map((r) => ({
          parameter: r.parameter,
          value: r.value,
          flag: (r.flag ?? undefined) as LabResult["flag"],
        }))
      : undefined,
    result: o.result ?? undefined,
    meds: (o.meds as Med[] | undefined)?.length ? (o.meds as Med[]) : undefined,
    createdAt: o.createdAt.toISOString(),
    completedAt: o.completedAt ? o.completedAt.toISOString() : undefined,
  };
}

type ServiceItemRow = Awaited<
  ReturnType<typeof prisma.serviceItem.findFirstOrThrow>
>;

function mapServiceItem(t: ServiceItemRow): ServiceItem {
  return {
    id: t.id,
    name: t.name,
    orderType: t.orderType as ServiceItem["orderType"],
    category: t.category,
    price: t.price,
    parameters: t.parameters.map((p) => ({
      name: p.name,
      unit: p.unit,
      refLow: p.refLow ?? undefined,
      refHigh: p.refHigh ?? undefined,
    })),
    active: t.active,
    createdAt: t.createdAt.toISOString(),
  };
}

type ClinicSettingsRow = Awaited<
  ReturnType<typeof prisma.clinicSettings.findFirstOrThrow>
>;

function mapSettings(s: ClinicSettingsRow): ClinicSettings {
  return {
    id: s.id,
    billingMode: s.billingMode as BillingMode,
    consultationFee: s.consultationFee,
    updatedAt: s.updatedAt.toISOString(),
    updatedById: s.updatedById ?? undefined,
  };
}

/** Read the singleton clinic settings, creating a default row on first call. */
async function readSettings(): Promise<ClinicSettings> {
  const existing = await prisma.clinicSettings.findFirst();
  if (existing) return mapSettings(existing);
  const created = await prisma.clinicSettings.create({ data: {} });
  return mapSettings(created);
}

// --- billing ---------------------------------------------------------------
//
// A charge is created the moment the thing being charged for is ordered, in
// both billing modes. The mode only decides whether the patient is *stopped*
// at that point: per-stage holds them at the cashier until the charge is
// settled, pay-at-end lets them walk on with the bill running and collects
// everything once, at the pharmacy.

type ChargeRow = VisitRow["charges"][number];

/** Service charges — the ones that gate `awaiting-lab-payment`. */
const SERVICE_CHARGE_TYPES: ChargeType[] = ["lab", "radiology", "procedure"];

/** A fresh unpaid charge row. Amounts are rounded to the cent so repeated
 *  float arithmetic can never leave a bill that won't settle to zero. */
function newCharge(
  type: ChargeType,
  description: string,
  amount: number,
): ChargeRow {
  return {
    id: crypto.randomUUID(),
    type,
    description,
    amount: Math.round(amount * 100) / 100,
    paid: false,
    paidAt: null,
    paymentId: null,
    createdAt: new Date(),
  };
}

function unpaid(charges: ChargeRow[]): ChargeRow[] {
  return charges.filter((c) => !c.paid);
}

function totalOf(charges: ChargeRow[]): number {
  return Math.round(charges.reduce((s, c) => s + c.amount, 0) * 100) / 100;
}

/** Mark `settled` as paid by `paymentId`, leaving every other charge alone. */
function settleCharges(
  charges: ChargeRow[],
  settled: ChargeRow[],
  paymentId: string,
  paidAt: Date,
): ChargeRow[] {
  const ids = new Set(settled.map((c) => c.id));
  return charges.map((c) =>
    ids.has(c.id) ? { ...c, paid: true, paidAt, paymentId } : c,
  );
}

/** The opening state of a new visit: the billing mode snapshot, the
 *  consultation charge (when the clinic charges one), and where the patient
 *  starts. Snapshotting the mode here is what stops an admin's mid-visit
 *  toggle from retroactively rewriting how this visit is charged. */
async function openingVisitState() {
  const settings = await readSettings();
  const charges =
    settings.consultationFee > 0
      ? [newCharge("consultation", "Consultation fee", settings.consultationFee)]
      : [];
  // A free consultation has nothing to collect, so there is no gate to hold
  // the patient at even in per-stage mode.
  const status: VisitStatus =
    settings.billingMode === "per-stage" && charges.length > 0
      ? "awaiting-consult-payment"
      : "awaiting-triage";
  return {
    billingMode: settings.billingMode,
    charges,
    status,
    timeline: [{ status, at: new Date() }],
  };
}

// --- absences ----------------------------------------------------------------

/** UTC-midnight bounds of today's calendar date. Activity dates arrive as
 *  "YYYY-MM-DD" strings, so they are stored as UTC midnights of the picked
 *  day — compare against the same representation. */
function todayBounds() {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Users with an approved absence in effect right now — a leave range that
 *  spans today, or an excuse whose leave→return window contains this moment.
 *  They vanish from the doctor roster and become active again automatically
 *  the moment the window lapses. */
async function absentUserIds(): Promise<Set<ID>> {
  const now = new Date();
  const { start, end } = todayBounds();
  const absences = await prisma.activityRequest.findMany({
    where: {
      status: "approved",
      OR: [
        { type: "leave", startDate: { lt: end }, endDate: { gte: start } },
        { type: "excuse", excuseDate: { gte: start, lt: end } },
      ],
    },
    select: { userId: true, type: true, excuseStart: true, excuseEnd: true },
  });

  const away = new Set<ID>();
  for (const a of absences) {
    if (a.type === "leave") {
      away.add(a.userId);
    } else if (a.excuseStart && a.excuseEnd) {
      // Timed excuse: away only between leaving and the return time.
      if (a.excuseStart <= now && now < a.excuseEnd) away.add(a.userId);
    } else {
      // Legacy excuse without a time: err on the side of the whole day.
      away.add(a.userId);
    }
  }
  return away;
}

/** Rejects routing a patient to a doctor who is away today. The roster
 *  already hides them; this guards against stale clients. */
async function doctorAbsentError(
  doctorId: ID | null | undefined,
): Promise<string | null> {
  if (!doctorId) return null;
  return (await absentUserIds()).has(doctorId)
    ? "That doctor is away today (approved leave or excuse). Please choose another doctor."
    : null;
}

// --- reads -----------------------------------------------------------------

/** Every staff member sees the whole clinic: all patients, their visit
 *  statuses and timings. (Who registered a patient is still recorded on the
 *  record, it just doesn't restrict visibility.) */
export async function getClinicData(opts?: {
  // Expenses are financial data — only admins get them in the dataset.
  includeFinance?: boolean;
}): Promise<ClinicData> {
  const [
    allDoctors,
    absent,
    patients,
    visits,
    orders,
    medicines,
    serviceCatalog,
    settings,
    expenses,
    cashCounts,
    mpesaTxns,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { role: "doctor", active: true },
      orderBy: { name: "asc" },
    }),
    absentUserIds(),
    prisma.patient.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.visit.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.order.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.medicine.findMany({ orderBy: { name: "asc" } }),
    prisma.serviceItem.findMany({
      where: { active: true },
      orderBy: [{ orderType: "asc" }, { category: "asc" }, { name: "asc" }],
    }),
    readSettings(),
    opts?.includeFinance
      ? prisma.expense.findMany({ orderBy: { date: "desc" } })
      : Promise.resolve([]),
    opts?.includeFinance
      ? prisma.cashCount.findMany({ orderBy: { date: "desc" } })
      : Promise.resolve([]),
    opts?.includeFinance
      ? prisma.mpesaTransaction.findMany({ orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
  ]);

  // Staff away today (approved leave/excuse) are not offered for assignment.
  const doctors = allDoctors.filter((d) => !absent.has(d.id));

  return {
    doctors: doctors.map(mapDoctor),
    patients: patients.map(mapPatient),
    visits: visits.map(mapVisit),
    orders: orders.map(mapOrder),
    medicines: medicines.map(mapMedicine),
    serviceCatalog: serviceCatalog.map(mapServiceItem),
    settings,
    expenses: expenses.map(mapExpense),
    cashCounts: cashCounts.map((c) => ({
      id: c.id,
      date: c.date.toISOString().slice(0, 10),
      counted: c.counted,
      notes: c.notes ?? undefined,
      countedBy: c.countedBy ?? undefined,
      createdAt: c.createdAt.toISOString(),
    })),
    mpesaTransactions: mpesaTxns.map((t) => ({
      id: t.id,
      phone: t.phone,
      amount: t.amount,
      status: t.status as "pending" | "success" | "failed",
      receipt: t.receipt ?? undefined,
      visitId: t.visitId ?? undefined,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

// --- writes ----------------------------------------------------------------

const EMPTY_VITALS: Vitals = { weight: "", temperature: "", bloodPressure: "" };

// Doctors take an unlimited queue: reception allocates as many patients as it
// likes and each doctor works through their own queue in priority order, so
// there is no "doctor is busy" rejection on assignment.

export async function registerPatient(input: {
  nationalId: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  age: number;
  phone: string;
  assignedDoctorId?: ID;
  registeredById?: ID; // stamped from the session by the API route
}) {
  const away = await doctorAbsentError(input.assignedDoctorId);
  if (away) return { error: away };

  // Never create a second record for the same national ID — the client's
  // lookup runs against a snapshot that may be stale.
  const nationalId = input.nationalId.trim();
  const existing = await prisma.patient.findFirst({
    where: { nationalId: { equals: nationalId, mode: "insensitive" } },
  });
  if (existing) {
    return {
      error: `A patient with national ID ${nationalId} is already registered (${existing.mrn} · ${existing.firstName} ${existing.lastName}). Use Find to check them in instead.`,
    };
  }

  const count = await prisma.patient.count();
  const mrn = `P-${String(count + 1).padStart(4, "0")}`;
  const patient = await prisma.patient.create({
    data: {
      mrn,
      nationalId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      gender: input.gender,
      age: input.age,
      phone: input.phone.trim(),
      registeredById: input.registeredById || null,
    },
  });
  await prisma.visit.create({
    data: {
      patientId: patient.id,
      vitals: EMPTY_VITALS,
      complaint: "",
      assignedDoctorId: input.assignedDoctorId || null,
      ...(await openingVisitState()),
    },
  });
}

export async function startVisit(input: {
  patientId: ID;
  assignedDoctorId?: ID;
}) {
  const away = await doctorAbsentError(input.assignedDoctorId);
  if (away) return { error: away };

  // One open visit per patient — guards against double-clicks and stale UIs.
  const open = await prisma.visit.findFirst({
    where: { patientId: input.patientId, status: { not: "completed" } },
  });
  if (open) {
    return { error: "This patient already has an active visit." };
  }

  await prisma.visit.create({
    data: {
      patientId: input.patientId,
      vitals: EMPTY_VITALS,
      complaint: "",
      assignedDoctorId: input.assignedDoctorId || null,
      ...(await openingVisitState()),
    },
  });
}

export async function recordTriage(input: {
  visitId: ID;
  vitals: Vitals;
  priority: Priority;
}) {
  const isEmergency = input.priority === "emergency";
  await prisma.visit.update({
    where: { id: input.visitId },
    data: {
      vitals: { set: input.vitals },
      priority: input.priority,
      // Emergency cases bypass the normal waiting queue and are
      // fast-tracked straight to doctor handling.
      status: isEmergency ? "with-doctor" : "waiting",
      timeline: stage(isEmergency ? "with-doctor" : "waiting"),
    },
  });
}

export async function assignVisitDoctor(input: { visitId: ID; doctorId: ID }) {
  const away = await doctorAbsentError(input.doctorId);
  if (away) return { error: away };

  await prisma.visit.update({
    where: { id: input.visitId },
    data: { assignedDoctorId: input.doctorId },
  });
}

// --- user management (admin) ----------------------------------------------



export interface StaffUser {
  id: ID;
  username: string;
  email: string | null;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

function mapUser(u: UserRow): StaffUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    name: u.name,
    role: u.role as Role,
    active: u.active,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Normalises an email for storage/lookup; returns null when blank. */
function cleanEmail(raw: string | undefined | null): string | null {
  const email = String(raw ?? "")
    .trim()
    .toLowerCase();
  return email || null;
}

/** Cheap format check — enough to catch typos typed into the setup form. */
function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** True when another user already owns this email (schema can't enforce it). */
async function emailTaken(email: string, exceptId?: ID): Promise<boolean> {
  const owner = await prisma.user.findFirst({ where: { email } });
  return Boolean(owner && owner.id !== exceptId);
}

export async function userCount(): Promise<number> {
  return prisma.user.count();
}

/** First-run setup: create the very first admin. Refuses once any user exists. */
export async function bootstrapAdmin(input: {
  name: string;
  username: string;
  email: string;
  password: string;
}): Promise<{ error: string } | { user: StaffUser }> {
  if ((await prisma.user.count()) > 0) {
    return { error: "Setup has already been completed." };
  }
  const username = input.username.trim().toLowerCase();
  if (!username || !input.name.trim() || !input.password) {
    return { error: "Name, username and password are all required." };
  }
  // The first admin must have an email. There is no other admin who could
  // reset their password, so the reset link is their only way back in.
  const email = cleanEmail(input.email);
  if (!email || !validEmail(email)) {
    return { error: "A valid email address is required." };
  }
  const user = await prisma.user.create({
    data: {
      username,
      email,
      name: input.name.trim(),
      role: "admin",
      passwordHash: await hashPassword(input.password),
      active: true,
    },
  });
  return { user: mapUser(user) };
}

export async function listUsers(): Promise<StaffUser[]> {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return users.map(mapUser);
}

export async function createUser(input: {
  username: string;
  email?: string;
  name: string;
  role: Role;
  password?: string;
}): Promise<{ error: string } | { user: StaffUser; tempPassword: string }> {
  const username = input.username.trim().toLowerCase();
  if (!username || !input.name.trim()) {
    return { error: "Username and name are required." };
  }
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return { error: "That username is already taken." };

  const email = cleanEmail(input.email);
  if (email && (await emailTaken(email))) {
    return { error: "That email is already used by another account." };
  }

  const password = String(input.password ?? "").trim();
  if (!password && !email) {
    return {
      error:
        "Provide either a temporary password or an email address for setup.",
    };
  }

  // When no temporary password is provided we generate a readable one and
  // email it to the new user together with their username.
  const bootstrapPassword = password || generateTempPassword();

  const user = await prisma.user.create({
    data: {
      username,
      email,
      name: input.name.trim(),
      role: input.role,
      passwordHash: await hashPassword(bootstrapPassword),
      active: true,
    },
  });
  return { user: mapUser(user), tempPassword: bootstrapPassword };
}

export async function updateUser(input: {
  id: ID;
  role?: Role;
  active?: boolean;
  password?: string;
  email?: string;
}): Promise<{ error: string } | { user: StaffUser }> {
  const data: {
    role?: string;
    active?: boolean;
    passwordHash?: string;
    email?: string | null;
  } = {};
  if (input.role) data.role = input.role;
  if (typeof input.active === "boolean") data.active = input.active;
  if (input.password) data.passwordHash = await hashPassword(input.password);
  if (input.email !== undefined) {
    const email = cleanEmail(input.email);
    if (email && (await emailTaken(email, input.id))) {
      return { error: "That email is already used by another account." };
    }
    data.email = email;
  }
  const user = await prisma.user.update({ where: { id: input.id }, data });
  return { user: mapUser(user) };
}

export async function getUserById(id: ID): Promise<StaffUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? mapUser(user) : null;
}

export async function deleteUser(
  id: ID,
): Promise<{ error: string } | { ok: true }> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return { error: "User not found." };
  if (user.email?.toLowerCase() === "ccosmas001@gmail.com") {
    return { error: "This user cannot be deleted." };
  }
  await prisma.user.delete({ where: { id } });
  return { ok: true };
}

// --- password reset ----------------------------------------------------------

const RESET_TTL_MS = 30 * 60 * 1000; // links live for 30 minutes
// Setup links are emailed to someone who has no password yet and may not read
// their mail the same day, so they get a much longer window than a reset.
export const SETUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Starts a reset for the account with this email. Returns the plaintext token
 * (for the emailed link) plus the recipient, or null when no active account
 * matches — callers respond identically either way so the endpoint can't be
 * used to probe which emails exist.
 */
export async function createPasswordReset(
  rawEmail: string,
  ttlMs: number = RESET_TTL_MS,
): Promise<{ token: string; to: string; name: string } | null> {
  const email = cleanEmail(rawEmail);
  if (!email) return null;
  const user = await prisma.user.findFirst({ where: { email, active: true } });
  if (!user) return null;

  // A new request supersedes any outstanding links.
  await prisma.passwordReset.deleteMany({ where: { userId: user.id } });

  const token = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return { token, to: email, name: user.name };
}

/** Consumes a reset token and sets the new password. */
export async function resetPasswordWithToken(
  token: string,
  password: string,
): Promise<{ error: string } | { username: string }> {
  if (!password || password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }
  const reset = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(String(token ?? "")) },
  });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
    return { error: "This reset link is invalid or has expired. Request a new one." };
  }
  const user = await prisma.user.update({
    where: { id: reset.userId },
    data: { passwordHash: await hashPassword(password) },
  });
  await prisma.passwordReset.update({
    where: { id: reset.id },
    data: { usedAt: new Date() },
  });
  return { username: user.username };
}

// --- medicine catalog (admin) -----------------------------------------------

export async function addMedicine(input: {
  name: string;
  strength: string;
  form: string;
  unitPrice: number;
  costPrice?: number;
  stock: number;
}): Promise<{ error: string } | void> {
  const name = input.name?.trim();
  const strength = input.strength?.trim() ?? "";
  const form = input.form?.trim();
  if (!name || !form) return { error: "Name and form are required." };

  const unitPrice = Number(input.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { error: "Enter a valid unit price." };
  }
  const costPrice = Number(input.costPrice ?? 0);
  if (!Number.isFinite(costPrice) || costPrice < 0) {
    return { error: "Enter a valid cost price." };
  }
  const stock = Math.max(0, Math.round(Number(input.stock) || 0));

  // One catalog entry per name+strength — restock the existing one instead.
  const existing = await prisma.medicine.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      strength: { equals: strength, mode: "insensitive" },
    },
  });
  if (existing) {
    return {
      error: `${existing.name} ${existing.strength} is already in the catalog — update its stock or price in the list instead.`,
    };
  }

  await prisma.medicine.create({
    data: { name, strength, form, unitPrice, costPrice, stock },
  });
}

export async function updateMedicine(input: {
  id: ID;
  unitPrice?: number;
  costPrice?: number;
  stock?: number;
}): Promise<{ error: string } | void> {
  const data: { unitPrice?: number; costPrice?: number; stock?: number } = {};
  if (input.unitPrice !== undefined) {
    const unitPrice = Number(input.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return { error: "Enter a valid unit price." };
    }
    data.unitPrice = unitPrice;
  }
  if (input.costPrice !== undefined) {
    const costPrice = Number(input.costPrice);
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      return { error: "Enter a valid cost price." };
    }
    data.costPrice = costPrice;
  }
  if (input.stock !== undefined) {
    const stock = Math.round(Number(input.stock));
    if (!Number.isFinite(stock) || stock < 0) {
      return { error: "Stock must be zero or more." };
    }
    data.stock = stock;
  }
  if (Object.keys(data).length === 0) return;
  await prisma.medicine.update({ where: { id: input.id }, data });
}

export async function startConsult(input: { visitId: ID }) {
  await prisma.visit.update({
    where: { id: input.visitId },
    data: { status: "with-doctor", timeline: stage("with-doctor") },
  });
}

export async function setVisitComplaint(input: {
  visitId: ID;
  complaint: string;
}) {
  await prisma.visit.update({
    where: { id: input.visitId },
    data: { complaint: input.complaint },
  });
}

/** Order a service off the catalog. The title and price come from the catalog
 *  row, never from the client — the same rule the pharmacy POS applies to
 *  medicine prices. */
export async function addServiceOrder(input: {
  visitId: ID;
  serviceItemId: ID;
  instructions?: string;
}): Promise<{ error: string } | void> {
  const item = await prisma.serviceItem.findUnique({
    where: { id: input.serviceItemId },
  });
  if (!item || !item.active) {
    return { error: "That service is no longer in the catalog." };
  }
  const visit = await prisma.visit.findUnique({ where: { id: input.visitId } });
  if (!visit) return { error: "Visit not found." };

  await prisma.order.create({
    data: {
      visitId: input.visitId,
      type: item.orderType,
      title: item.name,
      instructions: input.instructions?.trim() || null,
      status: "requested",
      serviceItemId: item.id,
    },
  });

  // A free service raises no charge, so it never gates the patient.
  const charges =
    item.price > 0
      ? [...visit.charges, newCharge(item.orderType as ChargeType, item.name, item.price)]
      : visit.charges;
  const owesForServices = unpaid(charges).some((c) =>
    SERVICE_CHARGE_TYPES.includes(c.type as ChargeType),
  );
  const status: VisitStatus =
    visit.billingMode === "per-stage" && owesForServices
      ? "awaiting-lab-payment"
      : "awaiting-services";
  await prisma.visit.update({
    where: { id: input.visitId },
    data: { charges: { set: charges }, status, timeline: stage(status) },
  });
}

/** Create a doctor''s complete set of service requests before moving the patient. */
export async function addServiceOrders(input: {
  visitId: ID;
  serviceItemIds: ID[];
  instructions?: string;
}): Promise<{ error: string } | void> {
  const ids = [...new Set(input.serviceItemIds ?? [])];
  if (ids.length === 0) return { error: "Select at least one service." };

  const [visit, items] = await Promise.all([
    prisma.visit.findUnique({ where: { id: input.visitId } }),
    prisma.serviceItem.findMany({ where: { id: { in: ids }, active: true } }),
  ]);
  if (!visit) return { error: "Visit not found." };
  if (items.length !== ids.length) {
    return { error: "One of the selected services is no longer available." };
  }

  await prisma.order.createMany({
    data: items.map((item) => ({
      visitId: input.visitId,
      type: item.orderType,
      title: item.name,
      instructions: input.instructions?.trim() || null,
      status: "requested",
      serviceItemId: item.id,
      results: [],
      meds: [],
    })),
  });

  const charges = items.reduce(
    (all, item) =>
      item.price > 0
        ? [...all, newCharge(item.orderType as ChargeType, item.name, item.price)]
        : all,
    [...visit.charges],
  );
  const owesForServices = unpaid(charges).some((c) =>
    SERVICE_CHARGE_TYPES.includes(c.type as ChargeType),
  );
  const status: VisitStatus =
    visit.billingMode === "per-stage" && owesForServices
      ? "awaiting-lab-payment"
      : "awaiting-services";
  await prisma.visit.update({
    where: { id: input.visitId },
    data: { charges: { set: charges }, status, timeline: stage(status) },
  });
}

/** Take money for some of a visit's outstanding charges — reception's two
 *  pay-gates both come through here. Records one VisitPayment covering the
 *  settled lines, then releases the patient if that clears their gate. */
export async function payCharges(input: {
  visitId: ID;
  chargeIds: ID[];
  method: PaymentMethod;
  reference?: string;
  takenBy?: string;
}): Promise<{ error: string } | void> {
  const visit = await prisma.visit.findUnique({ where: { id: input.visitId } });
  if (!visit) return { error: "Visit not found." };

  // Settle only lines that are still outstanding, so a double-submitted form
  // can never take the same money twice.
  const wanted = new Set(input.chargeIds ?? []);
  const settling = visit.charges.filter((c) => wanted.has(c.id) && !c.paid);
  if (settling.length === 0) {
    return { error: "Those charges have already been paid." };
  }

  const total = totalOf(settling);

  // Same rule as the pharmacy checkout: with PayHero configured, an M-Pesa
  // payment must point at a push we actually saw succeed, for this exact
  // amount. `reference` is the CheckoutRequestID; the receipt replaces it.
  let reference = input.reference?.trim() || undefined;
  if (input.method === "mpesa" && mpesaConfigured()) {
    const tx = reference
      ? await prisma.mpesaTransaction.findUnique({
          where: { checkoutRequestId: reference },
        })
      : null;
    if (!tx) {
      return { error: "Send the M-Pesa request and wait for it to confirm." };
    }
    if (tx.status !== "success") {
      return { error: "The M-Pesa payment has not been confirmed yet." };
    }
    if (tx.amount !== Math.max(1, Math.round(total))) {
      return {
        error:
          "The bill changed after the M-Pesa request. Send a new payment request.",
      };
    }
    if (tx.visitId && tx.visitId !== input.visitId) {
      return { error: "That M-Pesa payment was used for another visit." };
    }
    // A visit pays at more than one gate, so being tied to this visit is not
    // enough — the same push must not settle a second gate for free.
    const alreadySpent = visit.payments.some(
      (p) =>
        p.reference &&
        (p.reference === tx.receipt || p.reference === tx.checkoutRequestId),
    );
    if (alreadySpent) {
      return { error: "That M-Pesa payment was already used on this visit." };
    }
    await prisma.mpesaTransaction.update({
      where: { checkoutRequestId: tx.checkoutRequestId },
      data: { visitId: input.visitId },
    });
    reference = tx.receipt ?? tx.checkoutRequestId;
  }

  const paidAt = new Date();
  const payment = {
    id: crypto.randomUUID(),
    amount: total,
    method: input.method,
    reference: reference ?? null,
    paidAt,
    covers: settling.map((c) => c.id),
    takenBy: input.takenBy ?? null,
  };
  const charges = settleCharges(visit.charges, settling, payment.id, paidAt);

  // Releasing the gate: the patient moves on only once nothing of that kind is
  // still outstanding — a doctor may have ordered three tests and been paid
  // for two.
  const stillOwes = unpaid(charges);
  let status = visit.status as VisitStatus;
  if (
    status === "awaiting-consult-payment" &&
    !stillOwes.some((c) => c.type === "consultation")
  ) {
    status = "awaiting-triage";
  } else if (
    status === "awaiting-lab-payment" &&
    !stillOwes.some((c) => SERVICE_CHARGE_TYPES.includes(c.type as ChargeType))
  ) {
    status = "awaiting-services";
  }

  await prisma.visit.update({
    where: { id: input.visitId },
    data: {
      charges: { set: charges },
      payments: { push: payment },
      ...(status !== visit.status ? { status, timeline: stage(status) } : {}),
    },
  });
}

export async function addPrescription(input: {
  visitId: ID;
  meds: Omit<Med, "id" | "dispensed">[];
}) {
  const meds: Med[] = input.meds.map((m) => ({
    ...m,
    id: crypto.randomUUID(),
    dispensed: false,
  }));
  await prisma.order.create({
    data: {
      visitId: input.visitId,
      type: "prescription",
      title: "Prescription",
      status: "requested",
      meds,
    },
  });
}

export async function startServiceOrder(input: { orderId: ID }) {
  await prisma.order.update({
    where: { id: input.orderId },
    data: { status: "in-progress" },
  });
}

/** File a service result. Labs report per-parameter values against the catalog
 *  panel; radiology and procedures report a free-text finding. The low/high
 *  flag is derived here from the catalog's reference range rather than trusted
 *  from the client, so a range correction can't be contradicted by old data. */
export async function completeServiceOrder(input: {
  orderId: ID;
  result?: string;
  results?: LabResult[];
}): Promise<{ error: string } | void> {
  const existing = await prisma.order.findUnique({
    where: { id: input.orderId },
  });
  if (!existing) return { error: "Order not found." };

  const item = existing.serviceItemId
    ? await prisma.serviceItem.findUnique({
        where: { id: existing.serviceItemId },
      })
    : null;
  const requiredParameters = item?.parameters ?? [];
  const submitted = new Map(
    (input.results ?? []).map((result) => [result.parameter, result.value?.trim() ?? ""]),
  );
  if (
    requiredParameters.length > 0 &&
    requiredParameters.some((parameter) => !submitted.get(parameter.name))
  ) {
    return { error: "Complete every required result before returning the patient." };
  }
  const ranges = new Map(requiredParameters.map((p) => [p.name, p]));

  const results = requiredParameters.map((parameter) => {
      const resultValue = submitted.get(parameter.name) ?? "";
      const range = ranges.get(parameter.name);
      const value = Number(resultValue);
      let flag: LabResult["flag"];
      // Qualitative results ("positive") simply carry no flag.
      if (range && Number.isFinite(value)) {
        if (range.refLow != null && value < range.refLow) flag = "low";
        else if (range.refHigh != null && value > range.refHigh) flag = "high";
        else if (range.refLow != null || range.refHigh != null) flag = "normal";
      }
      return { parameter: parameter.name, value: resultValue, flag: flag ?? null };
    });

  const freeText = input.result?.trim();
  if (results.length === 0 && !freeText) {
    return { error: "Enter a result before filing it." };
  }

  const order = await prisma.order.update({
    where: { id: input.orderId },
    data: {
      status: "completed",
      results: { set: results },
      result: freeText || null,
      completedAt: new Date(),
    },
  });
  // Return the patient to the doctor only once every ordered service is done.
  const stillPending = await prisma.order.count({
    where: {
      visitId: order.visitId,
      type: { not: "prescription" },
      status: { not: "completed" },
    },
  });
  if (stillPending === 0) {
    await prisma.visit.update({
      where: { id: order.visitId },
      data: { status: "back-to-doctor", timeline: stage("back-to-doctor") },
    });
  }
}

export async function sendToPharmacy(input: { visitId: ID }) {
  await prisma.visit.update({
    where: { id: input.visitId },
    data: { status: "awaiting-pharmacy", timeline: stage("awaiting-pharmacy") },
  });
}

export async function toggleMedDispensed(input: {
  orderId: ID;
  medId: ID;
}) {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
  });
  if (!order?.meds) return;
  const meds = (order.meds as Med[]).map((m) =>
    m.id === input.medId ? { ...m, dispensed: !m.dispensed } : m,
  );
  await prisma.order.update({
    where: { id: input.orderId },
    data: { meds: { set: meds } },
  });
}

/** Close a visit with nothing to sell. Only legitimate once the bill is clear
 *  — anything outstanding has to go through the POS so the money is recorded. */
export async function dispenseAndClose(input: {
  visitId: ID;
}): Promise<{ error: string } | void> {
  const visit = await prisma.visit.findUnique({ where: { id: input.visitId } });
  if (!visit) return { error: "Visit not found." };
  const owed = unpaid(visit.charges);
  if (owed.length > 0) {
    return {
      error: `This visit still owes ${totalOf(owed)} — take the payment at the POS to close it.`,
    };
  }
  await prisma.order.updateMany({
    where: { visitId: input.visitId, type: "prescription" },
    data: { status: "completed", completedAt: new Date() },
  });
  await prisma.visit.update({
    where: { id: input.visitId },
    data: { status: "completed", timeline: stage("completed") },
  });
}

/** Pharmacy POS: sell the carted medicines, settle everything still owed on
 *  the visit, and close it. Prices come from the catalog (never the client)
 *  and stock is checked and decremented here.
 *
 *  This is where pay-at-end visits finally pay: the payment covers the carted
 *  medicines *plus* every charge that accumulated earlier (consultation, lab).
 *  In per-stage mode those earlier charges are already settled, so the same
 *  code path just bills the medicines. */
export async function checkoutVisit(input: {
  visitId: ID;
  method: PaymentMethod;
  reference?: string;
  items: { medicineId: ID; quantity: number }[];
  takenBy?: string;
}): Promise<{ error: string } | { payment: Payment }> {
  const items = (input.items ?? []).map((i) => ({
    medicineId: i.medicineId,
    quantity: Math.max(1, Math.round(i.quantity)),
  }));

  // A retried checkout (e.g. the response got lost after an M-Pesa success)
  // must not sell the cart twice: hand back the payment already recorded.
  const visit = await prisma.visit.findUnique({
    where: { id: input.visitId },
  });
  if (!visit) return { error: "Visit not found." };
  if (visit.status === "completed") {
    if (visit.payment) {
      return {
        payment: {
          amount: visit.payment.amount,
          method: visit.payment.method as PaymentMethod,
          reference: visit.payment.reference ?? undefined,
          paidAt: visit.payment.paidAt.toISOString(),
        },
      };
    }
    return { error: "This visit is already closed." };
  }

  // A patient who was never prescribed anything still has to settle what they
  // ran up on the way through, so an empty cart is fine as long as something
  // is outstanding.
  const outstanding = unpaid(visit.charges);
  if (items.length === 0 && outstanding.length === 0) {
    return { error: "The cart is empty — add at least one medicine." };
  }

  const medicines = await prisma.medicine.findMany({
    where: { id: { in: items.map((i) => i.medicineId) } },
  });
  const byId = new Map(medicines.map((m) => [m.id, m]));

  const saleItems: {
    medicineId: ID;
    name: string;
    quantity: number;
    unitPrice: number;
    unitCost: number;
  }[] = [];
  for (const item of items) {
    const med = byId.get(item.medicineId);
    if (!med) return { error: "A carted medicine no longer exists." };
    if (med.stock < item.quantity) {
      return {
        error: `Not enough ${med.name} ${med.strength} in stock (${med.stock} left).`,
      };
    }
    saleItems.push({
      medicineId: med.id,
      name: `${med.name} ${med.strength}`.trim(),
      quantity: item.quantity,
      unitPrice: med.unitPrice,
      unitCost: med.costPrice,
    });
  }
  // One charge per sale line, settled by this same payment — so a receipt and
  // the visit's bill always tell the same story.
  const pharmacyCharges = saleItems.map((i) =>
    newCharge(
      "pharmacy",
      i.quantity > 1 ? `${i.name} × ${i.quantity}` : i.name,
      i.quantity * i.unitPrice,
    ),
  );
  const settling = [...outstanding, ...pharmacyCharges];
  const total = totalOf(settling);

  // With Daraja configured, an M-Pesa checkout must point at a transaction we
  // actually saw succeed, for the same amount. `reference` is the
  // CheckoutRequestID from the STK push; the receipt becomes the reference.
  let reference = input.reference?.trim() || undefined;
  if (input.method === "mpesa" && mpesaConfigured()) {
    const tx = reference
      ? await prisma.mpesaTransaction.findUnique({
          where: { checkoutRequestId: reference },
        })
      : null;
    if (!tx) {
      return { error: "Send the M-Pesa request and wait for it to confirm." };
    }
    if (tx.status !== "success") {
      return { error: "The M-Pesa payment has not been confirmed yet." };
    }
    if (tx.amount !== Math.max(1, Math.round(total))) {
      return {
        error:
          "The bill changed after the M-Pesa request. Send a new payment request.",
      };
    }
    if (tx.visitId && tx.visitId !== input.visitId) {
      return { error: "That M-Pesa payment was used for another visit." };
    }
    await prisma.mpesaTransaction.update({
      where: { checkoutRequestId: tx.checkoutRequestId },
      data: { visitId: input.visitId },
    });
    reference = tx.receipt ?? tx.checkoutRequestId;
  }

  // One transaction: a failure mid-way must not leave stock decremented
  // without the visit closed (or vice versa), or a retry would sell twice.
  const paidAt = new Date();
  const paymentId = crypto.randomUUID();
  const charges = settleCharges(
    [...visit.charges, ...pharmacyCharges],
    settling,
    paymentId,
    paidAt,
  );
  await prisma.$transaction([
    ...items.map((item) =>
      prisma.medicine.update({
        where: { id: item.medicineId },
        data: { stock: { decrement: item.quantity } },
      }),
    ),
    prisma.order.updateMany({
      where: { visitId: input.visitId, type: "prescription" },
      data: { status: "completed", completedAt: new Date() },
    }),
    prisma.visit.update({
      where: { id: input.visitId },
      data: {
        status: "completed",
        timeline: stage("completed"),
        saleItems,
        charges: { set: charges },
        payments: {
          push: {
            id: paymentId,
            amount: total,
            method: input.method,
            reference: reference ?? null,
            paidAt,
            covers: settling.map((c) => c.id),
            takenBy: input.takenBy ?? null,
          },
        },
        // Legacy single-payment field, still written so the pre-charges
        // reporting path keeps working for visits closed at the POS.
        payment: {
          set: {
            amount: total,
            method: input.method,
            reference: reference ?? null,
            paidAt,
          },
        },
      },
    }),
  ]);
  return {
    payment: {
      amount: total,
      method: input.method,
      reference,
      paidAt: paidAt.toISOString(),
    },
  };
}

// --- expenses (admin) --------------------------------------------------------

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "rent",
  "salaries",
  "utilities",
  "supplies",
  "equipment",
  "other",
];

export async function addExpense(input: {
  description: string;
  category: string;
  amount: number;
  date: string; // "YYYY-MM-DD" from the date picker
  recordedById?: ID; // stamped from the session by the API route
  recordedBy?: string;
}): Promise<{ error: string } | void> {
  const description = input.description?.trim();
  if (!description) return { error: "Describe the expense." };

  const category = EXPENSE_CATEGORIES.includes(input.category as ExpenseCategory)
    ? input.category
    : "other";

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter an amount greater than zero." };
  }

  // Stored as the UTC midnight of the picked day, like activity dates.
  const date = new Date(`${input.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { error: "Pick a valid date." };

  await prisma.expense.create({
    data: {
      description,
      category,
      amount,
      date,
      recordedById: input.recordedById || null,
      recordedBy: input.recordedBy || null,
    },
  });
}

/** Save (or replace) the physical cash count for a day. One count per day —
 *  re-entering the same date overwrites it, so a recount just works. */
export async function recordCashCount(input: {
  date: string; // "YYYY-MM-DD" from the date picker
  counted: number;
  notes?: string;
  countedById?: ID; // stamped from the session by the API route
  countedBy?: string;
}): Promise<{ error: string } | void> {
  const counted = Number(input.counted);
  if (!Number.isFinite(counted) || counted < 0) {
    return { error: "Enter the counted cash amount (zero or more)." };
  }
  // Stored as the UTC midnight of the picked day, like expense dates.
  const date = new Date(`${input.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { error: "Pick a valid date." };
  if (date.getTime() > Date.now()) {
    return { error: "You cannot count cash for a future date." };
  }

  await prisma.cashCount.upsert({
    where: { date },
    update: {
      counted,
      notes: input.notes?.trim() || null,
      countedById: input.countedById || null,
      countedBy: input.countedBy || null,
    },
    create: {
      date,
      counted,
      notes: input.notes?.trim() || null,
      countedById: input.countedById || null,
      countedBy: input.countedBy || null,
    },
  });
}

export async function deleteExpense(input: {
  id: ID;
}): Promise<{ error: string } | void> {
  const expense = await prisma.expense.findUnique({ where: { id: input.id } });
  if (!expense) return { error: "Expense not found." };
  await prisma.expense.delete({ where: { id: input.id } });
}

// --- settings --------------------------------------------------------------

/** Update the singleton clinic settings. Missing fields are left untouched;
 *  changing `billingMode` only affects visits opened afterwards (existing
 *  visits keep their snapshotted `billingMode`). */
export async function updateSettings(input: {
  billingMode?: BillingMode;
  consultationFee?: number;
  updatedById?: ID;
}): Promise<{ error: string } | void> {
  if (input.consultationFee !== undefined && input.consultationFee < 0) {
    return { error: "Consultation fee cannot be negative." };
  }
  if (
    input.billingMode !== undefined &&
    input.billingMode !== "per-stage" &&
    input.billingMode !== "pay-at-end"
  ) {
    return { error: "Unknown billing mode." };
  }
  const existing = await prisma.clinicSettings.findFirst();
  const data = {
    ...(input.billingMode !== undefined && { billingMode: input.billingMode }),
    ...(input.consultationFee !== undefined && {
      consultationFee: input.consultationFee,
    }),
    updatedById: input.updatedById ?? null,
  };
  if (existing) {
    await prisma.clinicSettings.update({ where: { id: existing.id }, data });
  } else {
    await prisma.clinicSettings.create({ data });
  }
}

// --- service catalog (admin) ------------------------------------------------

const ORDER_TYPES: ServiceItem["orderType"][] = ["lab", "radiology", "procedure"];

/** Shared validation for both catalog writes. */
function cleanServiceItem(input: {
  name?: string;
  orderType?: string;
  category?: string;
  price?: number;
  parameters?: LabParameter[];
}): { error: string } | {
  name: string;
  orderType: string;
  category: string;
  price: number;
  parameters: LabParameter[];
} {
  const name = (input.name ?? "").trim();
  if (!name) return { error: "Give the service a name." };
  const orderType = (input.orderType ?? "") as ServiceItem["orderType"];
  if (!ORDER_TYPES.includes(orderType)) {
    return { error: "Pick lab, radiology or procedure." };
  }
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) {
    return { error: "Price must be zero or a positive number." };
  }
  // Only labs report against a parameter panel; the others are free-text.
  const parameters =
    orderType === "lab"
      ? (input.parameters ?? [])
          .filter((p) => p.name?.trim())
          .map((p) => ({
            name: p.name.trim(),
            unit: (p.unit ?? "").trim(),
            refLow: Number.isFinite(Number(p.refLow)) ? Number(p.refLow) : null,
            refHigh: Number.isFinite(Number(p.refHigh))
              ? Number(p.refHigh)
              : null,
          }))
      : [];
  return {
    name,
    orderType,
    category: (input.category ?? "other").trim() || "other",
    price: Math.round(price * 100) / 100,
    parameters: parameters as unknown as LabParameter[],
  };
}

export async function addServiceItem(input: {
  name: string;
  orderType: ServiceItem["orderType"];
  category: string;
  price: number;
  parameters?: LabParameter[];
}): Promise<{ error: string } | void> {
  const clean = cleanServiceItem(input);
  if ("error" in clean) return clean;

  // Two rows with the same name would leave the doctor guessing which to order.
  const existing = await prisma.serviceItem.findFirst({
    where: { name: { equals: clean.name, mode: "insensitive" } },
  });
  if (existing) {
    return { error: `"${clean.name}" is already in the catalog.` };
  }
  await prisma.serviceItem.create({ data: clean });
}

/** Edit a catalog entry. Re-pricing never touches charges already raised —
 *  those keep the price that was quoted when the service was ordered. */
export async function updateServiceItem(input: {
  id: ID;
  name: string;
  orderType: ServiceItem["orderType"];
  category: string;
  price: number;
  parameters?: LabParameter[];
  active?: boolean;
}): Promise<{ error: string } | void> {
  const item = await prisma.serviceItem.findUnique({ where: { id: input.id } });
  if (!item) return { error: "Service not found." };
  const clean = cleanServiceItem(input);
  if ("error" in clean) return clean;

  const clash = await prisma.serviceItem.findFirst({
    where: {
      name: { equals: clean.name, mode: "insensitive" },
      id: { not: input.id },
    },
  });
  if (clash) return { error: `"${clean.name}" is already in the catalog.` };

  await prisma.serviceItem.update({
    where: { id: input.id },
    data: {
      ...clean,
      ...(input.active !== undefined && { active: input.active }),
    },
  });
}
