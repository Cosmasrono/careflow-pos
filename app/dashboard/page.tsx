"use client";

import Link from "next/link";
import { useClinic } from "@/lib/store";
import { Card, PageHeader } from "@/components/ui";
import {
  LOCATION_LABELS,
  type VisitLocation,
  visitLocation,
} from "@/lib/selectors";

const STAGES: { location: VisitLocation; href: string }[] = [
  { location: "reception", href: "/reception" },
  { location: "consultation", href: "/doctor" },
  { location: "lab", href: "/services" },
  { location: "radiology", href: "/services" },
  { location: "procedure", href: "/services" },
  { location: "pharmacy", href: "/pharmacy" },
];

const QUICK_ACTIONS = [
  { href: "/reception", label: "Check in patient", detail: "Find or register a patient" },
  { href: "/flow", label: "View patient flow", detail: "See delays across the clinic" },
  { href: "/admin/reconciliation", label: "Reconcile payments", detail: "Compare cash and M-Pesa" },
  { href: "/admin/medicines", label: "Review stock", detail: "Update medicines and prices" },
];

export default function Dashboard() {
  const data = useClinic();
  const count = (location: VisitLocation) =>
    data.visits.filter((v) => visitLocation(data, v) === location).length;
  const completedToday = data.visits.filter(
    (v) => v.status === "completed",
  ).length;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live overview of every patient in the building"
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {STAGES.map((s) => (
          <Link key={s.location} href={s.href}>
            <Card className="transition-colors hover:border-teal-400">
              <p className="text-3xl font-semibold text-zinc-900">
                {count(s.location)}
              </p>
              <p className="mt-1 text-xs font-medium text-zinc-500">
                {LOCATION_LABELS[s.location]}
              </p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-zinc-500">Total patients</p>
          <p className="mt-1 text-2xl font-semibold">{data.patients.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-500">Active visits</p>
          <p className="mt-1 text-2xl font-semibold">
            {data.visits.filter((v) => v.status !== "completed").length}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-500">Completed visits</p>
          <p className="mt-1 text-2xl font-semibold">{completedToday}</p>
        </Card>
      </div>

      <section className="mt-6" aria-labelledby="quick-actions-title">
        <h2 id="quick-actions-title" className="mb-3 text-sm font-semibold text-teal-950">
          Common tasks
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="group rounded-2xl border border-teal-950/[0.07] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-600/30 hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-teal-950">{action.label}</p>
                <span aria-hidden className="text-teal-600 transition-transform group-hover:translate-x-1">→</span>
              </div>
              <p className="mt-1 text-sm text-zinc-500">{action.detail}</p>
            </Link>
          ))}
        </div>
      </section>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-700">
          How a patient flows
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          Reception registers the patient, routes them to a doctor, then takes
          vitals and sets priority → Doctor consults and may order{" "}
          <strong>lab, radiology or procedures</strong> → patient returns to the
          doctor with results → doctor prescribes → Pharmacy dispenses and closes
          the visit. Each number above is a live queue — click to jump to that
          station.
        </p>
      </Card>
    </div>
  );
}
