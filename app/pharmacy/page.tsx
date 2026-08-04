"use client";

import { useState } from "react";
import { PrinterIcon } from "lucide-react";
import { checkoutVisit, dispenseAndClose, useClinic } from "@/lib/store";
import type {
  ID,
  Medicine,
  Order,
  PaymentMethod,
  Visit,
} from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  LocationBadge,
  PageHeader,
  cn,
  inputClass,
} from "@/components/ui";
import {
  chargesTotal,
  ordersForVisit,
  outstandingCharges,
  patientMap,
  patientName,
  visitLocation,
  visitsByStatus,
} from "@/lib/selectors";
import { StkBanner, useStkEnabled, useStkPush } from "@/components/MpesaPrompt";

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "mpesa", label: "M-Pesa" },
  { key: "card", label: "Card" },
];

const money = (n: number) =>
  `KSh ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

const medicineLabel = (m: Medicine) =>
  `${m.name} ${m.strength}`.replace(" —", "").trim();

interface Receipt {
  patient: string;
  mrn: string;
  items: { name: string; quantity: number; unitPrice: number }[];
  total: number;
  method: PaymentMethod;
  reference: string;
  at: Date;
}

export default function PharmacyPage() {
  const data = useClinic();
  const pmap = patientMap(data);
  const queue = visitsByStatus(data, "awaiting-pharmacy");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // PayHero credentials present? If not, M-Pesa falls back to manual entry.
  const stkEnabled = useStkEnabled();

  return (
    <div>
      <PageHeader
        title="Pharmacy"
        subtitle="Search the shelf, build the patient's cart, take payment, and close the visit"
      />

      {receipt && (
        <ReceiptCard receipt={receipt} onDismiss={() => setReceipt(null)} />
      )}

      {queue.length === 0 ? (
        <EmptyState>No prescriptions waiting to be dispensed.</EmptyState>
      ) : (
        <div className="grid gap-4">
          {queue.map((visit) => (
            <PosCard
              key={visit.id}
              visit={visit}
              patientLabel={patientName(pmap.get(visit.patientId))}
              mrn={pmap.get(visit.patientId)?.mrn ?? ""}
              prescriptions={ordersForVisit(data, visit.id).filter(
                (o) => o.type === "prescription",
              )}
              stkEnabled={stkEnabled}
              onPaid={setReceipt}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One patient's point of sale: the doctor's prescription as a reference,
 *  a catalog search, a cart, and checkout. */
function PosCard({
  visit,
  patientLabel,
  mrn,
  prescriptions,
  stkEnabled,
  onPaid,
}: {
  visit: Visit;
  patientLabel: string;
  mrn: string;
  prescriptions: Order[];
  stkEnabled: boolean;
  onPaid: (r: Receipt) => void;
}) {
  const data = useClinic();
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Map<ID, number>>(new Map()); // medicineId → qty
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalog = new Map(data.medicines.map((m) => [m.id, m]));
  const prescribed = prescriptions.flatMap((o) => o.meds ?? []);

  const q = query.trim().toLowerCase();
  const results = q
    ? data.medicines
        .filter((m) =>
          `${m.name} ${m.strength} ${m.form}`.toLowerCase().includes(q),
        )
        .slice(0, 6)
    : [];

  const setQty = (id: ID, qty: number) =>
    setCart((c) => {
      const next = new Map(c);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });
  const addToCart = (m: Medicine) => {
    setQty(m.id, Math.min((cart.get(m.id) ?? 0) + 1, m.stock));
    setQuery("");
  };

  const cartLines = [...cart.entries()]
    .map(([id, qty]) => ({ med: catalog.get(id), qty }))
    .filter((l): l is { med: Medicine; qty: number } => !!l.med);
  const cartTotal = cartLines.reduce((s, l) => s + l.qty * l.med.unitPrice, 0);

  // Everything the patient still owes from earlier stages. In per-stage
  // billing this is empty (reception already collected); in pay-at-end it is
  // the consultation and any tests, all settled here in one go.
  const owed = outstandingCharges(visit);
  const total = cartTotal + chargesTotal(owed);

  const inStock = cartLines.every((l) => l.qty <= l.med.stock);
  const stkFlow = method === "mpesa" && stkEnabled;
  const needsReference = method !== "cash" && !stkFlow;
  // A patient who was never prescribed anything still has to settle their
  // bill, so an empty cart is fine as long as something is outstanding.
  const hasSomethingToSettle = cartLines.length > 0 || owed.length > 0;
  // …and a patient who paid at every gate and was prescribed nothing has no
  // money left to take: the desk just closes them out. A prescription with an
  // empty cart is never this case — those medicines still have to be sold.
  const nothingToCollect = !hasSomethingToSettle && prescribed.length === 0;
  const ready =
    hasSomethingToSettle &&
    inStock &&
    (!needsReference || reference.trim() !== "");

  const checkout = async (serverReference?: string, shownReference?: string) => {
    setBusy(true);
    setError(null);
    const err = await checkoutVisit(
      visit.id,
      method,
      serverReference ?? reference,
      cartLines.map((l) => ({ medicineId: l.med.id, quantity: l.qty })),
    );
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onPaid({
      patient: patientLabel,
      mrn,
      items: [
        // Earlier stages first — the receipt then reads in the order the
        // patient actually ran the charges up.
        ...owed.map((c) => ({
          name: c.description,
          quantity: 1,
          unitPrice: c.amount,
        })),
        ...cartLines.map((l) => ({
          name: medicineLabel(l.med),
          quantity: l.qty,
          unitPrice: l.med.unitPrice,
        })),
      ],
      total,
      method,
      reference: shownReference ?? serverReference ?? reference.trim(),
      at: new Date(),
    });
  };

  /** Close a visit with nothing to dispense and nothing left to pay. The
   *  server refuses if anything is still outstanding, so no bill can be
   *  walked out of here. */
  const closeWithoutSale = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await dispenseAndClose(visit.id);
    setBusy(false);
    if (err) setError(err);
  };

  // Payment confirmed on the customer's phone → finish the sale automatically.
  const {
    stk,
    busy: stkBusy,
    error: stkError,
    request,
    reset: resetStk,
  } = useStkPush((checkoutRequestId, receipt) =>
    void checkout(checkoutRequestId, receipt),
  );

  const requestStk = () =>
    void request({
      phone,
      accountReference: mrn || "CareFlow",
      // The server re-prices the cart and adds whatever the visit still owes,
      // so the pushed amount always matches what checkout expects.
      visitId: visit.id,
      items: cartLines.map((l) => ({
        medicineId: l.med.id,
        quantity: l.qty,
      })),
    });

  const shownError = error ?? stkError;

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{patientLabel}</h2>
          <p className="text-sm text-zinc-500">
            {mrn} · {visit.complaint || "—"}
          </p>
        </div>
        <LocationBadge location={visitLocation(data, visit)} />
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        {/* Left: what the doctor prescribed + catalog search */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-700">
            Prescription
          </h3>
          {prescribed.length === 0 ? (
            <p className="text-sm text-zinc-500">No prescription lines.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-zinc-700">
              {prescribed.map((m) => (
                <li key={m.id} className="rounded-lg bg-zinc-50 px-3 py-2">
                  <strong>{m.name}</strong> — {m.dosage}, {m.frequency},{" "}
                  {m.duration}
                </li>
              ))}
            </ul>
          )}

          <h3 className="mb-2 mt-4 text-sm font-semibold text-zinc-700">
            Find medicine
          </h3>
          <input
            className={`${inputClass} w-full`}
            placeholder="Search the shelf… e.g. amox"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {q && (
            <ul className="mt-2 flex flex-col gap-1">
              {results.length === 0 && (
                <li className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
                  Nothing on the shelf matches “{query}”.
                </li>
              )}
              {results.map((m) => {
                const out = m.stock <= (cart.get(m.id) ?? 0);
                return (
                  <li
                    key={m.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  >
                    <span>
                      <strong>{medicineLabel(m)}</strong>{" "}
                      <span className="text-zinc-500">
                        · {m.form} · {money(m.unitPrice)} ·{" "}
                        {m.stock > 0 ? `${m.stock} in stock` : "out of stock"}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={out}
                      onClick={() => addToCart(m)}
                    >
                      {out ? "Out of stock" : "Add"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Right: cart + payment */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-700">
            Cart ({cartLines.length})
          </h3>
          {cartLines.length === 0 && (
            <p className="rounded-lg bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">
              {owed.length > 0
                ? "Nothing to dispense — you can still settle the bill below."
                : "Search the shelf and add medicines to the cart."}
            </p>
          )}
          {cartLines.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {cartLines.map(({ med, qty }) => (
                <li
                  key={med.id}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2"
                >
                  <span className="flex-1">
                    <strong>{medicineLabel(med)}</strong>{" "}
                    <span className="text-zinc-500">
                      @ {money(med.unitPrice)}
                    </span>
                  </span>
                  <input
                    className={`${inputClass} h-8 w-16 px-2`}
                    type="number"
                    min={1}
                    max={med.stock}
                    value={qty}
                    onChange={(e) =>
                      setQty(
                        med.id,
                        Math.min(Number(e.target.value) || 0, med.stock),
                      )
                    }
                  />
                  <span className="w-24 text-right font-medium">
                    {money(qty * med.unitPrice)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setQty(med.id, 0)}
                  >
                    ✕
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* Charges run up earlier in the visit. Only pay-at-end patients
              reach the POS still owing for these. */}
          {owed.length > 0 && (
            <div className="mt-3">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
                Owing from earlier
              </h4>
              <ul className="flex flex-col gap-1 text-sm">
                {owed.map((c) => (
                  <li
                    key={c.id}
                    className="flex justify-between rounded-lg bg-amber-50 px-3 py-2"
                  >
                    <span className="text-amber-900">{c.description}</span>
                    <span className="tabular-nums text-amber-900">
                      {money(c.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasSomethingToSettle && (
            <div className="mt-2 flex justify-between border-t border-zinc-200 px-3 pt-2 text-base font-semibold">
              <span>Total due</span>
              <span className="tabular-nums text-teal-700">{money(total)}</span>
            </div>
          )}

          {/* Nothing to dispense and nothing owed — there is no payment to
              take, so the till hides itself and just offers the exit. */}
          {nothingToCollect && (
            <p className="mt-3 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600">
              Nothing was prescribed and the bill is fully settled — there is no
              money left to take.
            </p>
          )}

          <div
            className={cn(
              "mt-3 grid gap-3 sm:grid-cols-2",
              nothingToCollect && "hidden",
            )}
          >
            <Field label="Payment method">
              <select
                className={inputClass}
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value as PaymentMethod);
                  resetStk();
                  setError(null);
                }}
              >
                {METHODS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            {stkFlow ? (
              <Field label="Customer phone (Safaricom)">
                <input
                  className={inputClass}
                  placeholder="e.g. 0712 345678"
                  value={phone}
                  disabled={stk?.status === "pending"}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
            ) : (
              <Field
                label={
                  method === "mpesa"
                    ? "M-Pesa code"
                    : method === "card"
                      ? "Card reference"
                      : "Reference (optional)"
                }
              >
                <input
                  className={inputClass}
                  placeholder={method === "mpesa" ? "e.g. SGH4X2K9QT" : ""}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            )}
          </div>

          {shownError && (
            <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {shownError}
            </p>
          )}

          {stkFlow && stk && (
            <StkBanner
              stk={stk}
              phone={phone}
              onReset={resetStk}
              success={
                error ? (
                  <>
                    the visit did not close.{" "}
                    <button
                      className="underline"
                      disabled={busy}
                      onClick={() =>
                        void checkout(stk.id, stk.receipt ?? stk.id)
                      }
                    >
                      Retry closing the visit
                    </button>
                  </>
                ) : (
                  "closing the visit…"
                )
              }
            />
          )}

          {nothingToCollect ? (
            <Button
              className="mt-4 w-full"
              variant="secondary"
              disabled={busy}
              onClick={closeWithoutSale}
            >
              {busy ? "Closing…" : "Close visit — nothing to collect"}
            </Button>
          ) : stkFlow ? (
            <Button
              className="mt-4 w-full"
              disabled={
                !ready ||
                busy ||
                stkBusy ||
                !phone.trim() ||
                stk?.status === "pending" ||
                stk?.status === "success"
              }
              onClick={requestStk}
            >
              {!hasSomethingToSettle
                ? "Add the prescribed medicines to the cart"
                : !inStock
                  ? "Not enough stock for the cart"
                  : !phone.trim()
                    ? "Enter the customer's phone number"
                    : stk?.status === "pending"
                      ? "Waiting for M-Pesa…"
                      : `Request ${money(Math.max(1, Math.round(total)))} via M-Pesa`}
            </Button>
          ) : (
            <Button
              className="mt-4 w-full"
              disabled={!ready || busy}
              onClick={() => checkout()}
            >
              {!hasSomethingToSettle
                ? "Add the prescribed medicines to the cart"
                : !inStock
                  ? "Not enough stock for the cart"
                  : needsReference && !reference.trim()
                    ? "Enter the payment reference"
                    : `Take ${money(total)} & close visit`}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Confirmation of the last sale — what a printed receipt would show. */
function ReceiptCard({
  receipt,
  onDismiss,
}: {
  receipt: Receipt;
  onDismiss: () => void;
}) {
  const methodLabel =
    METHODS.find((m) => m.key === receipt.method)?.label ?? receipt.method;
  return (
    <Card id="payment-receipt" className="mb-6 border-teal-300 bg-teal-50/50">
      <div className="flex items-start justify-between">
        <div>
          <p className="hidden text-center text-lg font-bold text-zinc-900 print:block">
            CareFlow Clinic
          </p>
          <h2 className="text-sm font-semibold text-teal-900 print:mt-2 print:text-zinc-900">
            Payment received — visit closed
          </h2>
          <p className="mt-1 text-xs text-teal-700">
            {receipt.patient} ({receipt.mrn}) ·{" "}
            {receipt.at.toLocaleTimeString()} · {methodLabel}
            {receipt.reference ? ` · ${receipt.reference}` : ""}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            <PrinterIcon className="size-4" />
            Print receipt
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-sm text-zinc-700">
        {receipt.items.map((item, i) => (
          <li key={i} className="flex justify-between">
            <span>
              {item.name} × {item.quantity}
            </span>
            <span>{money(item.quantity * item.unitPrice)}</span>
          </li>
        ))}
        <li className="mt-1 flex justify-between border-t border-teal-200 pt-2 font-semibold">
          <span>Total paid</span>
          <span>{money(receipt.total)}</span>
        </li>
      </ul>
    </Card>
  );
}
