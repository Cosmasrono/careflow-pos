"use client";

import { useState } from "react";
import { completeServiceOrder, startServiceOrder, useClinic } from "@/lib/store";
import type { LabParameter, Order, OrderType } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  inputClass,
} from "@/components/ui";
import { openServiceOrders, patientName } from "@/lib/selectors";
import { useSession } from "@/components/SessionProvider";

type Filter = "all" | Exclude<OrderType, "prescription">;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "lab", label: "Lab" },
  { key: "radiology", label: "Radiology" },
  { key: "procedure", label: "Procedures" },
];

export default function ServicesPage() {
  const data = useClinic();
  const session = useSession();
  // Technicians land on their own department; everyone can still switch tabs.
  const [filter, setFilter] = useState<Filter>(
    session?.role === "lab" || session?.role === "radiology"
      ? session.role
      : "all",
  );
  const items = openServiceOrders(
    data,
    filter === "all" ? undefined : filter,
  );

  return (
    <div>
      <PageHeader
        title="Lab / Radiology / Procedures"
        subtitle="Outstanding service orders. Enter a result to send the patient back to the doctor."
      />

      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f.key
                ? "bg-teal-600 text-white"
                : "bg-white text-zinc-600 border border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState>No outstanding orders in this department.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map(({ order, patient }) => (
            <ResultCard
              key={order.id}
              order={order}
              // Labs report against the catalog's parameter panel; radiology
              // and procedures report a free-text finding.
              parameters={
                data.serviceCatalog.find((s) => s.id === order.serviceItemId)
                  ?.parameters ?? []
              }
              patient={patientName(patient)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({
  order,
  parameters,
  patient,
}: {
  order: Order;
  parameters: LabParameter[];
  patient: string;
}) {
  // Panel entry keyed by parameter name; free-text for everything else.
  const [values, setValues] = useState<Record<string, string>>({});
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);

  const status = order.status;
  const locked = status === "requested";
  const panel = parameters.length > 0;
  const filled = panel
    ? parameters.some((p) => values[p.name]?.trim())
    : freeText.trim() !== "";

  const file = async () => {
    setBusy(true);
    await completeServiceOrder(
      order.id,
      panel
        ? {
            results: parameters.map((p) => ({
              parameter: p.name,
              value: values[p.name]?.trim() ?? "",
            })),
            // A panel can still carry an overall comment.
            result: freeText.trim() || undefined,
          }
        : { result: freeText },
    );
    setBusy(false);
  };

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium">{order.title}</p>
          <p className="text-xs text-zinc-500">
            {patient} · <span className="capitalize">{order.type}</span>
          </p>
        </div>
        <StatusBadge status={status} />
      </div>
      {order.instructions && (
        <p className="mt-2 text-xs text-zinc-500">Note: {order.instructions}</p>
      )}
      {locked && (
        <Button
          className="mt-3 w-full"
          variant="secondary"
          onClick={() => startServiceOrder(order.id)}
        >
          Start work
        </Button>
      )}

      {panel ? (
        <div className="mt-3 flex flex-col gap-2">
          {parameters.map((p) => (
            <div key={p.name} className="flex items-center gap-2">
              <label className="w-32 shrink-0 text-xs text-zinc-600">
                {p.name}
                {p.unit && (
                  <span className="ml-1 text-zinc-400">({p.unit})</span>
                )}
              </label>
              <input
                className={`${inputClass} flex-1`}
                value={values[p.name] ?? ""}
                disabled={locked}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [p.name]: e.target.value }))
                }
              />
              {(p.refLow != null || p.refHigh != null) && (
                <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-zinc-400">
                  {p.refLow ?? ""}–{p.refHigh ?? ""}
                </span>
              )}
            </div>
          ))}
          <textarea
            className={`${inputClass} h-14 w-full py-2`}
            placeholder="Comment (optional)…"
            value={freeText}
            disabled={locked}
            onChange={(e) => setFreeText(e.target.value)}
          />
        </div>
      ) : (
        <textarea
          className={`${inputClass} mt-3 h-20 w-full py-2`}
          placeholder="Enter result / findings…"
          value={freeText}
          disabled={locked}
          onChange={(e) => setFreeText(e.target.value)}
        />
      )}

      <Button
        className="mt-3 w-full"
        disabled={locked || !filled || busy}
        onClick={file}
      >
        {locked
          ? "Start work before saving result"
          : "Save result & return to doctor"}
      </Button>
    </Card>
  );
}
