"use client";

// Admin reports: revenue, visit throughput, orders, pharmacy and stock.
// Everything is computed client-side from the same /api/clinic dataset the
// rest of the app uses, filtered by the selected period.
//
// Two audiences share these numbers, so each block exists twice: the cards and
// tables on screen are trimmed to what fits, while every CSV export carries
// the full underlying rows so the figures can be audited in a spreadsheet.

import { useMemo, useState, type ReactNode } from "react";
import { DownloadIcon, PrinterIcon } from "lucide-react";
import { useClinic } from "@/lib/store";
import {
  Button,
  Card,
  PageHeader,
  EmptyState,
  cn,
  inputClass,
} from "@/components/ui";
import {
  chargesTotal,
  doctorMap,
  doctorName,
  formatDuration,
  outstandingTotal,
  patientMap,
  patientName,
  paymentsOf,
} from "@/lib/selectors";
import {
  downloadCsv,
  exportDate,
  exportDateTime,
  fileStamp,
  section,
  sectionsToCsv,
  type Column,
  type CsvSection,
} from "@/lib/export";
import type {
  Charge,
  ChargeType,
  OrderType,
  PaymentMethod,
  Visit,
} from "@/lib/types";

type Preset = "today" | "7d" | "30d" | "month" | "all" | "custom";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The [from, to) window a preset (or the custom inputs) resolves to. */
function resolveRange(
  preset: Preset,
  fromInput: string,
  toInput: string,
): { from: number; to: number } {
  const now = new Date();
  const endOfToday =
    new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + DAY_MS;

  switch (preset) {
    case "today":
      return { from: endOfToday - DAY_MS, to: endOfToday };
    case "7d":
      return { from: endOfToday - 7 * DAY_MS, to: endOfToday };
    case "30d":
      return { from: endOfToday - 30 * DAY_MS, to: endOfToday };
    case "month":
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
        to: endOfToday,
      };
    case "custom": {
      // A blank input means "open ended" on that side rather than an error.
      const from = fromInput ? new Date(`${fromInput}T00:00:00`).getTime() : 0;
      const to = toInput
        ? new Date(`${toInput}T00:00:00`).getTime() + DAY_MS
        : endOfToday;
      return {
        from: Number.isNaN(from) ? 0 : from,
        to: Number.isNaN(to) ? endOfToday : to,
      };
    }
    default:
      return { from: 0, to: endOfToday };
  }
}

function rangeLabel(preset: Preset, from: number, to: number): string {
  if (preset === "all") return "All time";
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString("en-KE", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  return `${fmt(from)} – ${fmt(to - 1)}`;
}

/** Total time in clinic for a completed visit, from its timeline. */
function visitDurationMs(v: Visit): number | null {
  const t = v.timeline;
  if (!t || t.length < 2) return null;
  const done = t.find((e) => e.status === "completed");
  if (!done) return null;
  return new Date(done.at).getTime() - new Date(t[0].at).getTime();
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  mpesa: "M-Pesa",
  card: "Card",
};

const ORDER_LABELS: Record<OrderType, string> = {
  lab: "Lab tests",
  radiology: "Radiology",
  procedure: "Procedures",
  prescription: "Prescriptions",
};

const CHARGE_LABELS: Record<ChargeType, string> = {
  consultation: "Consultation",
  lab: "Laboratory",
  radiology: "Radiology",
  procedure: "Procedures",
  pharmacy: "Pharmacy",
  misc: "Other",
};

const money = (n: number) =>
  `KSh ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

/** Round to whole cents for export columns — spreadsheets want numbers. */
const num = (n: number) => Math.round(n * 100) / 100;

export default function ReportsPage() {
  const data = useClinic();
  const [preset, setPreset] = useState<Preset>("7d");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const { from, to } = useMemo(
    () => resolveRange(preset, fromInput, toInput),
    [preset, fromInput, toInput],
  );

  const report = useMemo(() => {
    const inRange = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= from && t < to;
    };

    const patients = patientMap(data);
    const doctors = doctorMap(data);
    const nameOf = (visit: Visit) => patientName(patients.get(visit.patientId));

    const visits = data.visits.filter((v) => inRange(v.createdAt));
    const completed = visits.filter((v) => v.status === "completed");

    // Every payment taken in the window, flattened out of the visits holding
    // them. A per-stage visit pays several times — counting only the closing
    // payment would lose all the consultation and lab money.
    const takings = data.visits
      .flatMap((v) => paymentsOf(v).map((payment) => ({ visit: v, payment })))
      .filter((t) => inRange(t.payment.paidAt))
      .sort(
        (a, b) =>
          new Date(b.payment.paidAt).getTime() -
          new Date(a.payment.paidAt).getTime(),
      );
    const paid = [...new Set(takings.map((t) => t.visit))];
    const revenue = takings.reduce((sum, t) => sum + t.payment.amount, 0);

    // Revenue split by payment method.
    const byMethod = new Map<PaymentMethod, { count: number; amount: number }>();
    for (const { payment } of takings) {
      const entry = byMethod.get(payment.method) ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += payment.amount;
      byMethod.set(payment.method, entry);
    }

    // Revenue split by what was actually being paid for. A payment names the
    // charges it settles, so the money lands on the right department; legacy
    // lump payments carry no `covers` and fall into "Unallocated".
    const byLine = new Map<string, { count: number; amount: number }>();
    const bump = (key: string, amount: number) => {
      const e = byLine.get(key) ?? { count: 0, amount: 0 };
      e.count += 1;
      e.amount += amount;
      byLine.set(key, e);
    };
    for (const { visit, payment } of takings) {
      const charges = new Map<string, Charge>(
        (visit.charges ?? []).map((c) => [c.id, c]),
      );
      const covered = payment.covers
        .map((id) => charges.get(id))
        .filter((c): c is Charge => Boolean(c));
      if (covered.length === 0) {
        bump("unallocated", payment.amount);
        continue;
      }
      for (const c of covered) bump(c.type, c.amount);
    }

    // Daily revenue bars — the last 30 days of the window at most, so a long
    // range stays readable.
    const barFrom = Math.max(from, to - 30 * DAY_MS);
    const daily: {
      label: string;
      iso: string;
      amount: number;
      visits: number;
    }[] = [];
    for (let d = barFrom; d < to; d += DAY_MS) {
      const cursor = new Date(d);
      const start = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate(),
      ).getTime();
      const end = start + DAY_MS;
      let amount = 0;
      for (const { payment } of takings) {
        const at = new Date(payment.paidAt).getTime();
        if (at >= start && at < end) amount += payment.amount;
      }
      const dayVisits = visits.filter((v) => {
        const at = new Date(v.createdAt).getTime();
        return at >= start && at < end;
      }).length;
      daily.push({
        label: new Date(start).toLocaleDateString("en-KE", {
          day: "numeric",
          month: "short",
        }),
        iso: new Date(start).toISOString(),
        amount,
        visits: dayVisits,
      });
    }

    // Visit throughput.
    const durations = completed
      .map(visitDurationMs)
      .filter((ms): ms is number => ms !== null);
    const avgDuration =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : null;

    // Orders raised in the window, by department and by individual test.
    const orders = data.orders.filter((o) => inRange(o.createdAt));
    const byOrderType = new Map<OrderType, number>();
    for (const o of orders) {
      byOrderType.set(
        o.type as OrderType,
        (byOrderType.get(o.type as OrderType) ?? 0) + 1,
      );
    }
    const serviceUse = new Map<
      string,
      {
        title: string;
        type: OrderType;
        ordered: number;
        completed: number;
        revenue: number;
      }
    >();
    const priceOf = new Map(data.serviceCatalog.map((s) => [s.id, s.price]));
    for (const o of orders) {
      if (o.type === "prescription") continue;
      const key = `${o.type}:${o.title}`;
      const entry = serviceUse.get(key) ?? {
        title: o.title,
        type: o.type as OrderType,
        ordered: 0,
        completed: 0,
        revenue: 0,
      };
      entry.ordered += 1;
      if (o.status === "completed") entry.completed += 1;
      entry.revenue += o.serviceItemId ? (priceOf.get(o.serviceItemId) ?? 0) : 0;
      serviceUse.set(key, entry);
    }
    const services = [...serviceUse.values()].sort(
      (a, b) => b.ordered - a.ordered,
    );

    // Per-doctor workload. Revenue is every charge raised on that doctor's
    // visits that has since been settled — an approximation of what the
    // doctor's clinic time brought in.
    const perDoctor = new Map<
      string,
      {
        name: string;
        visits: number;
        completed: number;
        durations: number[];
        revenue: number;
      }
    >();
    for (const v of visits) {
      const id = v.assignedDoctorId ?? "unassigned";
      const entry = perDoctor.get(id) ?? {
        name:
          id === "unassigned"
            ? "Unassigned"
            : doctorName(doctors.get(id)) || "Unknown",
        visits: 0,
        completed: 0,
        durations: [] as number[],
        revenue: 0,
      };
      entry.visits += 1;
      if (v.status === "completed") entry.completed += 1;
      const ms = visitDurationMs(v);
      if (ms !== null) entry.durations.push(ms);
      entry.revenue += (v.charges ?? [])
        .filter((c) => c.paid)
        .reduce((s, c) => s + c.amount, 0);
      perDoctor.set(id, entry);
    }
    const doctorRows = [...perDoctor.values()]
      .map((d) => ({
        ...d,
        avgMs:
          d.durations.length > 0
            ? d.durations.reduce((a, b) => a + b, 0) / d.durations.length
            : null,
      }))
      .sort((a, b) => b.visits - a.visits);

    // Pharmacy sales, from the lines the POS actually rang up.
    const sales = new Map<
      string,
      { name: string; qty: number; amount: number; cost: number }
    >();
    for (const v of paid) {
      for (const item of v.saleItems ?? []) {
        const entry = sales.get(item.medicineId) ?? {
          name: item.name,
          qty: 0,
          amount: 0,
          cost: 0,
        };
        entry.qty += item.quantity;
        entry.amount += item.quantity * item.unitPrice;
        entry.cost += item.quantity * (item.unitCost ?? 0);
        sales.set(item.medicineId, entry);
      }
    }
    const medicines = [...sales.values()].sort((a, b) => b.amount - a.amount);

    // Stock is a snapshot, not a windowed figure — it is whatever is on the
    // shelf right now, regardless of the period selected.
    const stock = [...data.medicines].sort((a, b) => a.stock - b.stock);
    const lowStock = stock.filter((m) => m.stock <= 10);
    const stockValueCost = stock.reduce((s, m) => s + m.stock * m.costPrice, 0);
    const stockValueRetail = stock.reduce(
      (s, m) => s + m.stock * m.unitPrice,
      0,
    );

    // Money still owed. Also a snapshot: an unpaid bill matters today whenever
    // the visit happened, so this deliberately looks at every open visit.
    const debtors = data.visits
      .map((v) => ({ visit: v, owed: outstandingTotal(v) }))
      .filter((d) => d.owed > 0)
      .sort((a, b) => b.owed - a.owed);
    const outstanding = debtors.reduce((s, d) => s + d.owed, 0);

    const newPatients = data.patients.filter((p) => inRange(p.createdAt));

    return {
      nameOf,
      patients,
      doctors,
      revenue,
      paidVisits: paid.length,
      takings,
      byMethod,
      byLine,
      daily,
      visits,
      completedCount: completed.length,
      avgDuration,
      orders,
      byOrderType,
      services,
      doctorRows,
      medicines,
      stock,
      lowStock,
      stockValueCost,
      stockValueRetail,
      debtors,
      outstanding,
      newPatients,
    };
  }, [data, from, to]);

  const maxDaily = Math.max(1, ...report.daily.map((d) => d.amount));
  const label = rangeLabel(preset, from, to);

  // The order register joins each order back to its visit for the patient
  // columns; a map keeps that from being a scan per row.
  const visitById = useMemo(
    () => new Map(data.visits.map((v) => [v.id, v])),
    [data.visits],
  );

  // --- exports --------------------------------------------------------------
  // Each entry is a full dataset, not the truncated view on screen, so a
  // download can always be reconciled against the clinic's own books.

  const sections = useMemo((): {
    key: string;
    label: string;
    build: () => CsvSection;
  }[] => {
    const { nameOf, patients, doctors } = report;
    const cols = <T,>(c: Column<T>[]) => c;

    return [
      {
        key: "summary",
        label: "Summary",
        build: () =>
          section(
            "Summary",
            cols<{ metric: string; value: string | number }>([
              { header: "Metric", value: (r) => r.metric },
              { header: "Value", value: (r) => r.value },
            ]),
            [
              { metric: "Revenue collected (KSh)", value: num(report.revenue) },
              { metric: "Payments taken", value: report.takings.length },
              { metric: "Paid visits", value: report.paidVisits },
              { metric: "Visits", value: report.visits.length },
              { metric: "Visits completed", value: report.completedCount },
              {
                metric: "Average time in clinic",
                value:
                  report.avgDuration !== null
                    ? formatDuration(report.avgDuration)
                    : "",
              },
              { metric: "New patients", value: report.newPatients.length },
              { metric: "Orders raised", value: report.orders.length },
              {
                metric: "Outstanding balances (KSh)",
                value: num(report.outstanding),
              },
              {
                metric: "Stock value at cost (KSh)",
                value: num(report.stockValueCost),
              },
              {
                metric: "Stock value at retail (KSh)",
                value: num(report.stockValueRetail),
              },
            ],
          ),
      },
      {
        key: "payments",
        label: "Payments register",
        build: () =>
          section(
            "Payments register",
            cols<(typeof report.takings)[number]>([
              {
                header: "Paid at",
                value: (r) => exportDateTime(r.payment.paidAt),
              },
              { header: "Date", value: (r) => exportDate(r.payment.paidAt) },
              {
                header: "MRN",
                value: (r) => patients.get(r.visit.patientId)?.mrn ?? "",
              },
              { header: "Patient", value: (r) => nameOf(r.visit) },
              { header: "Method", value: (r) => METHOD_LABELS[r.payment.method] },
              { header: "Reference", value: (r) => r.payment.reference ?? "" },
              { header: "Amount (KSh)", value: (r) => num(r.payment.amount) },
              { header: "Taken by", value: (r) => r.payment.takenBy ?? "" },
              { header: "Billing mode", value: (r) => r.visit.billingMode },
              { header: "Visit ID", value: (r) => r.visit.id },
            ]),
            report.takings,
          ),
      },
      {
        key: "revenue-line",
        label: "Revenue by service line",
        build: () =>
          section(
            "Revenue by service line",
            cols<{ line: string; count: number; amount: number }>([
              { header: "Service line", value: (r) => r.line },
              { header: "Charges settled", value: (r) => r.count },
              { header: "Amount (KSh)", value: (r) => num(r.amount) },
            ]),
            [...report.byLine.entries()]
              .map(([key, v]) => ({
                line: CHARGE_LABELS[key as ChargeType] ?? "Unallocated",
                count: v.count,
                amount: v.amount,
              }))
              .sort((a, b) => b.amount - a.amount),
          ),
      },
      {
        key: "revenue-method",
        label: "Revenue by payment method",
        build: () =>
          section(
            "Revenue by payment method",
            cols<{ method: string; count: number; amount: number }>([
              { header: "Method", value: (r) => r.method },
              { header: "Payments", value: (r) => r.count },
              { header: "Amount (KSh)", value: (r) => num(r.amount) },
            ]),
            (Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => ({
              method: METHOD_LABELS[m],
              count: report.byMethod.get(m)?.count ?? 0,
              amount: report.byMethod.get(m)?.amount ?? 0,
            })),
          ),
      },
      {
        key: "daily",
        label: "Daily revenue",
        build: () =>
          section(
            "Daily revenue",
            cols<(typeof report.daily)[number]>([
              { header: "Date", value: (r) => exportDate(r.iso) },
              { header: "Revenue (KSh)", value: (r) => num(r.amount) },
              { header: "Visits", value: (r) => r.visits },
            ]),
            report.daily,
          ),
      },
      {
        key: "visits",
        label: "Visit register",
        build: () =>
          section(
            "Visit register",
            cols<Visit>([
              {
                header: "Checked in",
                value: (v) => exportDateTime(v.createdAt),
              },
              { header: "Date", value: (v) => exportDate(v.createdAt) },
              {
                header: "MRN",
                value: (v) => patients.get(v.patientId)?.mrn ?? "",
              },
              { header: "Patient", value: (v) => nameOf(v) },
              { header: "Age", value: (v) => patients.get(v.patientId)?.age ?? "" },
              {
                header: "Gender",
                value: (v) => patients.get(v.patientId)?.gender ?? "",
              },
              {
                header: "Phone",
                value: (v) => patients.get(v.patientId)?.phone ?? "",
              },
              {
                header: "Doctor",
                value: (v) =>
                  v.assignedDoctorId
                    ? doctorName(doctors.get(v.assignedDoctorId))
                    : "",
              },
              { header: "Priority", value: (v) => v.priority ?? "" },
              { header: "Status", value: (v) => v.status },
              { header: "Complaint", value: (v) => v.complaint },
              {
                header: "Minutes in clinic",
                value: (v) => {
                  const ms = visitDurationMs(v);
                  return ms === null ? "" : Math.round(ms / 60000);
                },
              },
              {
                header: "Charged (KSh)",
                value: (v) => num(chargesTotal(v.charges ?? [])),
              },
              {
                header: "Paid (KSh)",
                value: (v) =>
                  num(paymentsOf(v).reduce((s, p) => s + p.amount, 0)),
              },
              {
                header: "Outstanding (KSh)",
                value: (v) => num(outstandingTotal(v)),
              },
              { header: "Visit ID", value: (v) => v.id },
            ]),
            report.visits,
          ),
      },
      {
        key: "doctors",
        label: "Doctor productivity",
        build: () =>
          section(
            "Doctor productivity",
            cols<(typeof report.doctorRows)[number]>([
              { header: "Doctor", value: (r) => r.name },
              { header: "Visits", value: (r) => r.visits },
              { header: "Completed", value: (r) => r.completed },
              {
                header: "Avg minutes in clinic",
                value: (r) =>
                  r.avgMs === null ? "" : Math.round(r.avgMs / 60000),
              },
              { header: "Revenue settled (KSh)", value: (r) => num(r.revenue) },
            ]),
            report.doctorRows,
          ),
      },
      {
        key: "orders",
        label: "Order register",
        build: () =>
          section(
            "Order register",
            cols<(typeof report.orders)[number]>([
              { header: "Raised", value: (o) => exportDateTime(o.createdAt) },
              { header: "Type", value: (o) => ORDER_LABELS[o.type as OrderType] },
              { header: "Test / item", value: (o) => o.title },
              { header: "Status", value: (o) => o.status },
              {
                header: "Completed",
                value: (o) => (o.completedAt ? exportDateTime(o.completedAt) : ""),
              },
              {
                header: "Turnaround (min)",
                value: (o) =>
                  o.completedAt
                    ? Math.round(
                        (new Date(o.completedAt).getTime() -
                          new Date(o.createdAt).getTime()) /
                          60000,
                      )
                    : "",
              },
              {
                header: "MRN",
                value: (o) => {
                  const v = visitById.get(o.visitId);
                  return v ? (patients.get(v.patientId)?.mrn ?? "") : "";
                },
              },
              {
                header: "Patient",
                value: (o) => {
                  const v = visitById.get(o.visitId);
                  return v ? nameOf(v) : "";
                },
              },
              { header: "Visit ID", value: (o) => o.visitId },
            ]),
            report.orders,
          ),
      },
      {
        key: "services",
        label: "Service utilisation",
        build: () =>
          section(
            "Service utilisation",
            cols<(typeof report.services)[number]>([
              { header: "Test / service", value: (r) => r.title },
              { header: "Department", value: (r) => ORDER_LABELS[r.type] },
              { header: "Ordered", value: (r) => r.ordered },
              { header: "Completed", value: (r) => r.completed },
              { header: "Catalog value (KSh)", value: (r) => num(r.revenue) },
            ]),
            report.services,
          ),
      },
      {
        key: "pharmacy",
        label: "Pharmacy sales",
        build: () =>
          section(
            "Pharmacy sales",
            cols<(typeof report.medicines)[number]>([
              { header: "Medicine", value: (r) => r.name },
              { header: "Quantity sold", value: (r) => r.qty },
              { header: "Revenue (KSh)", value: (r) => num(r.amount) },
              { header: "Cost of goods (KSh)", value: (r) => num(r.cost) },
              { header: "Margin (KSh)", value: (r) => num(r.amount - r.cost) },
            ]),
            report.medicines,
          ),
      },
      {
        key: "stock",
        label: "Stock on hand",
        build: () =>
          section(
            "Stock on hand (current snapshot)",
            cols<(typeof report.stock)[number]>([
              { header: "Medicine", value: (m) => m.name },
              { header: "Strength", value: (m) => m.strength },
              { header: "Form", value: (m) => m.form },
              { header: "Units in stock", value: (m) => m.stock },
              { header: "Unit cost (KSh)", value: (m) => num(m.costPrice) },
              { header: "Unit price (KSh)", value: (m) => num(m.unitPrice) },
              {
                header: "Value at cost (KSh)",
                value: (m) => num(m.stock * m.costPrice),
              },
              {
                header: "Value at retail (KSh)",
                value: (m) => num(m.stock * m.unitPrice),
              },
              {
                header: "Status",
                value: (m) =>
                  m.stock === 0 ? "Out of stock" : m.stock <= 10 ? "Low" : "OK",
              },
            ]),
            report.stock,
          ),
      },
      {
        key: "debtors",
        label: "Outstanding balances",
        build: () =>
          section(
            "Outstanding balances (current snapshot)",
            cols<(typeof report.debtors)[number]>([
              {
                header: "Checked in",
                value: (d) => exportDateTime(d.visit.createdAt),
              },
              {
                header: "MRN",
                value: (d) => patients.get(d.visit.patientId)?.mrn ?? "",
              },
              { header: "Patient", value: (d) => nameOf(d.visit) },
              {
                header: "Phone",
                value: (d) => patients.get(d.visit.patientId)?.phone ?? "",
              },
              { header: "Status", value: (d) => d.visit.status },
              { header: "Outstanding (KSh)", value: (d) => num(d.owed) },
              { header: "Visit ID", value: (d) => d.visit.id },
            ]),
            report.debtors,
          ),
      },
      {
        key: "patients",
        label: "New patients",
        build: () =>
          section(
            "New patients",
            cols<(typeof report.newPatients)[number]>([
              { header: "Registered", value: (p) => exportDateTime(p.createdAt) },
              { header: "MRN", value: (p) => p.mrn },
              { header: "Name", value: (p) => `${p.firstName} ${p.lastName}` },
              { header: "National ID", value: (p) => p.nationalId },
              { header: "Gender", value: (p) => p.gender },
              { header: "Age", value: (p) => p.age },
              { header: "Phone", value: (p) => p.phone },
            ]),
            report.newPatients,
          ),
      },
    ];
  }, [report, visitById]);

  const meta = () => [
    "CarePharm Clinic — Reports",
    `Period: ${label}`,
    `Generated: ${exportDateTime(new Date().toISOString())}`,
  ];

  function exportOne(key: string) {
    const entry = sections.find((s) => s.key === key);
    if (!entry) return;
    downloadCsv(
      `carepharm-${key}-${fileStamp()}.csv`,
      sectionsToCsv([entry.build()], meta()),
    );
    setMenuOpen(false);
  }

  function exportAll() {
    downloadCsv(
      `carepharm-full-report-${fileStamp()}.csv`,
      sectionsToCsv(
        sections.map((s) => s.build()),
        meta(),
      ),
    );
    setMenuOpen(false);
  }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Reports"
          subtitle="Revenue, patient throughput, services and pharmacy performance"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1 rounded-full border border-zinc-200 bg-white p-1 shadow-sm">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPreset(p.key)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                      preset === p.key
                        ? "bg-teal-700 text-white"
                        : "text-zinc-600 hover:bg-teal-50 hover:text-teal-900",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Button size="sm" onClick={() => setMenuOpen((o) => !o)}>
                  <DownloadIcon className="size-4" />
                  Export
                </Button>
                {menuOpen && (
                  <>
                    <button
                      aria-label="Close export menu"
                      className="fixed inset-0 z-10 cursor-default"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
                      <button
                        onClick={exportAll}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-teal-800 hover:bg-teal-50"
                      >
                        Full report
                        <span className="text-xs font-normal text-zinc-400">
                          all sections
                        </span>
                      </button>
                      <div className="my-1 border-t border-zinc-100" />
                      {sections.map((s) => (
                        <button
                          key={s.key}
                          onClick={() => exportOne(s.key)}
                          className="block w-full px-3 py-2 text-left text-sm text-zinc-600 hover:bg-teal-50 hover:text-teal-900"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.print()}
              >
                <PrinterIcon className="size-4" />
                Print
              </Button>
            </div>
          }
        />

        {preset === "custom" && (
          <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-3">
            <label className="text-xs font-medium text-zinc-500">
              From
              <input
                type="date"
                value={fromInput}
                max={toInput || undefined}
                onChange={(e) => setFromInput(e.target.value)}
                className={cn(inputClass, "mt-1 h-9")}
              />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              To
              <input
                type="date"
                value={toInput}
                min={fromInput || undefined}
                onChange={(e) => setToInput(e.target.value)}
                className={cn(inputClass, "mt-1 h-9")}
              />
            </label>
            <p className="pb-2 text-xs text-zinc-400">
              Leave a side blank for an open-ended range.
            </p>
          </div>
        )}
      </div>

      {/* Letterhead shown only on the printed report */}
      <div className="mb-5 hidden border-b border-zinc-300 pb-4 print:block">
        <h1 className="text-xl font-semibold text-zinc-900">
          CarePharm Clinic — Operations Report
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Period: {label} · Printed{" "}
          {new Date().toLocaleDateString("en-KE", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Revenue"
          value={money(report.revenue)}
          hint={`${report.takings.length} payment${
            report.takings.length === 1 ? "" : "s"
          } · ${report.paidVisits} visit${report.paidVisits === 1 ? "" : "s"}`}
          accent
        />
        <Stat
          label="Visits"
          value={String(report.visits.length)}
          hint={`${report.completedCount} completed`}
        />
        <Stat
          label="Avg time in clinic"
          value={
            report.avgDuration !== null
              ? formatDuration(report.avgDuration)
              : "—"
          }
          hint="completed visits only"
        />
        <Stat
          label="New patients"
          value={String(report.newPatients.length)}
          hint="registered this period"
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Outstanding"
          value={money(report.outstanding)}
          hint={`${report.debtors.length} unpaid visit${
            report.debtors.length === 1 ? "" : "s"
          }`}
        />
        <Stat
          label="Orders raised"
          value={String(report.orders.length)}
          hint={`${report.services.length} distinct services`}
        />
        <Stat
          label="Stock value"
          value={money(report.stockValueCost)}
          hint={`${money(report.stockValueRetail)} at retail`}
        />
        <Stat
          label="Low stock items"
          value={String(report.lowStock.length)}
          hint={`of ${report.stock.length} catalog items`}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Daily revenue */}
        <Card>
          <h2 className="text-sm font-semibold text-zinc-700">Daily revenue</h2>
          {report.daily.every((d) => d.amount === 0) ? (
            <p className="mt-4 text-sm text-zinc-400">
              No payments recorded in this window.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {report.daily.map((d) => (
                <div key={d.iso} className="flex items-center gap-2 text-xs">
                  <span className="w-14 shrink-0 text-zinc-500">{d.label}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded-full bg-teal-900/5">
                    <div
                      className="h-full rounded-full bg-teal-600"
                      style={{ width: `${(d.amount / maxDaily) * 100}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right tabular-nums text-zinc-700">
                    {money(d.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Revenue by service line, method and order mix */}
        <Card>
          <h2 className="text-sm font-semibold text-zinc-700">
            Revenue by service line
          </h2>
          <div className="mt-3 space-y-2">
            {report.byLine.size === 0 ? (
              <p className="text-sm text-zinc-400">
                No settled charges in this window.
              </p>
            ) : (
              [...report.byLine.entries()]
                .sort((a, b) => b[1].amount - a[1].amount)
                .map(([key, v]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm"
                  >
                    <span className="text-zinc-600">
                      {CHARGE_LABELS[key as ChargeType] ?? "Unallocated"}
                    </span>
                    <span className="tabular-nums font-medium text-zinc-900">
                      {money(v.amount)}
                      <span className="ml-2 text-xs font-normal text-zinc-400">
                        {v.count} charge{v.count === 1 ? "" : "s"}
                      </span>
                    </span>
                  </div>
                ))
            )}
          </div>

          <h2 className="mt-5 text-sm font-semibold text-zinc-700">
            Payments by method
          </h2>
          <div className="mt-3 space-y-2">
            {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => {
              const entry = report.byMethod.get(m);
              return (
                <div
                  key={m}
                  className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm"
                >
                  <span className="text-zinc-600">{METHOD_LABELS[m]}</span>
                  <span className="tabular-nums font-medium text-zinc-900">
                    {money(entry?.amount ?? 0)}
                    <span className="ml-2 text-xs font-normal text-zinc-400">
                      {entry?.count ?? 0} payments
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          <h2 className="mt-5 text-sm font-semibold text-zinc-700">
            Orders by type
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(Object.keys(ORDER_LABELS) as OrderType[]).map((t) => (
              <div key={t} className="rounded-lg bg-zinc-50 px-3 py-2">
                <p className="text-xs text-zinc-500">{ORDER_LABELS[t]}</p>
                <p className="text-lg font-semibold text-zinc-900">
                  {report.byOrderType.get(t) ?? 0}
                </p>
              </div>
            ))}
          </div>
        </Card>

        {/* Doctor productivity */}
        <Card>
          <h2 className="text-sm font-semibold text-zinc-700">
            Doctor productivity
          </h2>
          {report.doctorRows.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-400">
              No visits in this window.
            </p>
          ) : (
            <TableWrap>
              <thead>
                <tr className="text-left text-xs text-zinc-400">
                  <th className="pb-2 font-medium">Doctor</th>
                  <th className="pb-2 text-right font-medium">Visits</th>
                  <th className="pb-2 text-right font-medium">Avg time</th>
                  <th className="pb-2 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {report.doctorRows.slice(0, 8).map((d) => (
                  <tr key={d.name} className="border-t border-zinc-100">
                    <td className="py-2 text-zinc-700">{d.name}</td>
                    <td className="py-2 text-right tabular-nums">
                      {d.visits}
                      <span className="ml-1 text-xs text-zinc-400">
                        / {d.completed} done
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-zinc-500">
                      {d.avgMs === null ? "—" : formatDuration(d.avgMs)}
                    </td>
                    <td className="py-2 text-right tabular-nums font-medium">
                      {money(d.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        {/* Service utilisation */}
        <Card>
          <h2 className="text-sm font-semibold text-zinc-700">
            Most requested services
          </h2>
          {report.services.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-400">
              No lab, imaging or procedure orders in this window.
            </p>
          ) : (
            <TableWrap>
              <thead>
                <tr className="text-left text-xs text-zinc-400">
                  <th className="pb-2 font-medium">Service</th>
                  <th className="pb-2 font-medium">Dept</th>
                  <th className="pb-2 text-right font-medium">Ordered</th>
                  <th className="pb-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {report.services.slice(0, 8).map((s) => (
                  <tr
                    key={`${s.type}:${s.title}`}
                    className="border-t border-zinc-100"
                  >
                    <td className="py-2 text-zinc-700">{s.title}</td>
                    <td className="py-2 text-xs text-zinc-400">
                      {ORDER_LABELS[s.type]}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {s.ordered}
                      <span className="ml-1 text-xs text-zinc-400">
                        / {s.completed} done
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums font-medium">
                      {money(s.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        {/* Top medicines */}
        <Card>
          <h2 className="text-sm font-semibold text-zinc-700">
            Top-selling medicines
          </h2>
          {report.medicines.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-400">
              No pharmacy sales in this window.
            </p>
          ) : (
            <TableWrap>
              <thead>
                <tr className="text-left text-xs text-zinc-400">
                  <th className="pb-2 font-medium">Medicine</th>
                  <th className="pb-2 text-right font-medium">Qty</th>
                  <th className="pb-2 text-right font-medium">Revenue</th>
                  <th className="pb-2 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {report.medicines.slice(0, 8).map((m) => (
                  <tr key={m.name} className="border-t border-zinc-100">
                    <td className="py-2 text-zinc-700">{m.name}</td>
                    <td className="py-2 text-right tabular-nums">{m.qty}</td>
                    <td className="py-2 text-right tabular-nums font-medium">
                      {money(m.amount)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-zinc-500">
                      {m.cost > 0 ? money(m.amount - m.cost) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        {/* Outstanding balances */}
        <Card>
          <h2 className="text-sm font-semibold text-zinc-700">
            Outstanding balances
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            Every unpaid visit, regardless of the period above.
          </p>
          {report.debtors.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-400">
              Nothing outstanding — every visit is settled.
            </p>
          ) : (
            <TableWrap>
              <thead>
                <tr className="text-left text-xs text-zinc-400">
                  <th className="pb-2 font-medium">Patient</th>
                  <th className="pb-2 font-medium">Checked in</th>
                  <th className="pb-2 text-right font-medium">Owed</th>
                </tr>
              </thead>
              <tbody>
                {report.debtors.slice(0, 8).map((d) => (
                  <tr key={d.visit.id} className="border-t border-zinc-100">
                    <td className="py-2 text-zinc-700">
                      {report.nameOf(d.visit)}
                      <span className="ml-1 text-xs text-zinc-400">
                        {report.patients.get(d.visit.patientId)?.mrn}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-zinc-500">
                      {exportDate(d.visit.createdAt)}
                    </td>
                    <td className="py-2 text-right tabular-nums font-medium text-amber-700">
                      {money(d.owed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        {/* Low stock */}
        <Card>
          <h2 className="text-sm font-semibold text-zinc-700">
            Low stock (≤ 10 units)
          </h2>
          {report.lowStock.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-400">
              All catalog items are sufficiently stocked.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {report.lowStock.slice(0, 8).map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm"
                >
                  <span className="text-zinc-700">
                    {m.name}{" "}
                    <span className="text-xs text-zinc-400">{m.strength}</span>
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset",
                      m.stock === 0
                        ? "bg-red-50 text-red-700 ring-red-600/25"
                        : "bg-amber-50 text-amber-800 ring-amber-600/25",
                    )}
                  >
                    {m.stock} left
                  </span>
                </div>
              ))}
              {report.lowStock.length > 8 && (
                <p className="text-xs text-zinc-400">
                  +{report.lowStock.length - 8} more — export “Stock on hand” for
                  the full list.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      <p className="mt-6 text-xs text-zinc-400 print:hidden">
        On-screen tables show the top rows; every CSV export carries the
        complete dataset for the selected period.
      </p>

      {data.visits.length === 0 && (
        <div className="mt-6">
          <EmptyState>
            No clinic data yet — reports fill in as visits are recorded.
          </EmptyState>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <p className="text-sm text-zinc-500">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold",
          accent ? "text-teal-900" : "text-zinc-900",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-zinc-400">{hint}</p>
    </Card>
  );
}

/** The small report tables share one horizontal-scroll shell on narrow screens. */
function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-3 w-full min-w-[380px] text-sm">{children}</table>
    </div>
  );
}
