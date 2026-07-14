"use client";

// Admin reports: revenue, visit throughput, orders and pharmacy insights.
// Everything is computed client-side from the same /api/clinic dataset the
// rest of the app uses, filtered by the selected period.

import { useMemo, useState } from "react";
import { useClinic } from "@/lib/store";
import { Card, PageHeader, EmptyState, cn } from "@/components/ui";
import { formatDuration } from "@/lib/selectors";
import type { OrderType, PaymentMethod, Visit } from "@/lib/types";

type Period = "today" | "7d" | "30d" | "all";

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "all", label: "All time" },
];

function periodStart(period: Period): number {
  const now = new Date();
  if (period === "all") return 0;
  if (period === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  const days = period === "7d" ? 7 : 30;
  return now.getTime() - days * 24 * 60 * 60 * 1000;
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

const money = (n: number) =>
  `KSh ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export default function ReportsPage() {
  const data = useClinic();
  const [period, setPeriod] = useState<Period>("7d");

  const report = useMemo(() => {
    const start = periodStart(period);
    const inPeriod = (iso: string) => new Date(iso).getTime() >= start;

    const visits = data.visits.filter((v) => inPeriod(v.createdAt));
    const completed = visits.filter((v) => v.status === "completed");
    const paid = data.visits.filter(
      (v) => v.payment && inPeriod(v.payment.paidAt),
    );

    // Revenue
    const revenue = paid.reduce((sum, v) => sum + (v.payment?.amount ?? 0), 0);
    const byMethod = new Map<PaymentMethod, { count: number; amount: number }>();
    for (const v of paid) {
      const p = v.payment!;
      const entry = byMethod.get(p.method) ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += p.amount;
      byMethod.set(p.method, entry);
    }

    // Daily revenue for the bar chart (last 14 days regardless of period,
    // except "today" which shows only today).
    const days = period === "today" ? 1 : period === "7d" ? 7 : 14;
    const daily: { label: string; amount: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const amount = data.visits.reduce((sum, v) => {
        if (!v.payment) return sum;
        const at = new Date(v.payment.paidAt).getTime();
        return at >= dayStart.getTime() && at < dayEnd.getTime()
          ? sum + v.payment.amount
          : sum;
      }, 0);
      daily.push({
        label: dayStart.toLocaleDateString("en-KE", {
          day: "numeric",
          month: "short",
        }),
        amount,
      });
    }

    // Visit throughput
    const durations = completed
      .map(visitDurationMs)
      .filter((ms): ms is number => ms !== null);
    const avgDuration =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : null;

    // Orders by type
    const orders = data.orders.filter((o) => inPeriod(o.createdAt));
    const byOrderType = new Map<OrderType, number>();
    for (const o of orders) {
      byOrderType.set(o.type as OrderType, (byOrderType.get(o.type as OrderType) ?? 0) + 1);
    }

    // Top-selling medicines from checkout sale lines
    const sales = new Map<string, { name: string; qty: number; amount: number }>();
    for (const v of paid) {
      for (const item of v.saleItems ?? []) {
        const entry = sales.get(item.medicineId) ?? {
          name: item.name,
          qty: 0,
          amount: 0,
        };
        entry.qty += item.quantity;
        entry.amount += item.quantity * item.unitPrice;
        sales.set(item.medicineId, entry);
      }
    }
    const topMedicines = [...sales.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    const lowStock = data.medicines
      .filter((m) => m.stock <= 10)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 8);

    const newPatients = data.patients.filter((p) => inPeriod(p.createdAt)).length;

    return {
      revenue,
      payments: paid.length,
      byMethod,
      daily,
      visits: visits.length,
      completed: completed.length,
      avgDuration,
      byOrderType,
      topMedicines,
      lowStock,
      newPatients,
    };
  }, [data, period]);

  const maxDaily = Math.max(1, ...report.daily.map((d) => d.amount));

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Revenue, patient throughput and pharmacy performance"
        action={
          <div className="flex gap-1 rounded-full border border-zinc-200 bg-white p-1 shadow-sm">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  period === p.key
                    ? "bg-teal-700 text-white"
                    : "text-zinc-600 hover:bg-teal-50 hover:text-teal-900",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-zinc-500">Revenue</p>
          <p className="mt-1 text-2xl font-semibold text-teal-900">
            {money(report.revenue)}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            {report.payments} paid visit{report.payments === 1 ? "" : "s"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-500">Visits</p>
          <p className="mt-1 text-2xl font-semibold">{report.visits}</p>
          <p className="mt-1 text-xs text-zinc-400">
            {report.completed} completed
          </p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-500">Avg time in clinic</p>
          <p className="mt-1 text-2xl font-semibold">
            {report.avgDuration !== null
              ? formatDuration(report.avgDuration)
              : "—"}
          </p>
          <p className="mt-1 text-xs text-zinc-400">completed visits only</p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-500">New patients</p>
          <p className="mt-1 text-2xl font-semibold">{report.newPatients}</p>
          <p className="mt-1 text-xs text-zinc-400">registered this period</p>
        </Card>
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
                <div key={d.label} className="flex items-center gap-2 text-xs">
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

        {/* Payment methods + order mix */}
        <Card>
          <h2 className="text-sm font-semibold text-zinc-700">
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

        {/* Top medicines */}
        <Card>
          <h2 className="text-sm font-semibold text-zinc-700">
            Top-selling medicines
          </h2>
          {report.topMedicines.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-400">
              No pharmacy sales in this window.
            </p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-400">
                  <th className="pb-2 font-medium">Medicine</th>
                  <th className="pb-2 text-right font-medium">Qty</th>
                  <th className="pb-2 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {report.topMedicines.map((m) => (
                  <tr key={m.name} className="border-t border-zinc-100">
                    <td className="py-2 text-zinc-700">{m.name}</td>
                    <td className="py-2 text-right tabular-nums">{m.qty}</td>
                    <td className="py-2 text-right tabular-nums font-medium">
                      {money(m.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              {report.lowStock.map((m) => (
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
            </div>
          )}
        </Card>
      </div>

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
