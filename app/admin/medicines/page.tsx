"use client";

// Pharmacy Catalog & Stock Management:
// 1. Edit a single specific medication in detail (Name, Strength, Form, Cost, Price, Stock).
// 2. Or unlock "Edit All" mode to adjust prices and quantities across all rows inline.
// 3. Apply Bulk Price Adjustments (e.g. +5% markup across formulary).
// 4. Excel/CSV Goods Importation and stock tracking.

import { useMemo, useState, useRef } from "react";
import {
  PillIcon,
  SearchIcon,
  AlertTriangleIcon,
  PackageCheckIcon,
  TrendingUpIcon,
  DollarSignIcon,
  PlusIcon,
  FilterIcon,
  ArrowUpDownIcon,
  CheckCircle2Icon,
  LayersIcon,
  SparklesIcon,
  ShieldAlertIcon,
  RefreshCwIcon,
  InfoIcon,
  FileSpreadsheetIcon,
  DownloadIcon,
  UploadIcon,
  XIcon,
  LockIcon,
  UnlockIcon,
  FileCheckIcon,
  Edit3Icon,
  SlidersHorizontalIcon,
  PercentIcon,
} from "lucide-react";
import { addMedicine, importMedicines, updateMedicine, useClinic } from "@/lib/store";
import type { Medicine } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Spinner,
  cn,
  inputClass,
} from "@/components/ui";
import { downloadCsv } from "@/lib/export";

const money = (n: number) =>
  `KSh ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

const FORMS = [
  "tablet",
  "capsule",
  "syrup",
  "suspension",
  "injection",
  "inhaler",
  "cream",
  "ointment",
  "drops",
  "sachet",
];

const FORM_STYLES: Record<string, { bg: string; text: string; ring: string }> = {
  tablet: { bg: "bg-teal-50", text: "text-teal-800", ring: "ring-teal-600/20" },
  capsule: { bg: "bg-indigo-50", text: "text-indigo-800", ring: "ring-indigo-600/20" },
  syrup: { bg: "bg-amber-50", text: "text-amber-800", ring: "ring-amber-600/25" },
  suspension: { bg: "bg-orange-50", text: "text-orange-800", ring: "ring-orange-600/25" },
  injection: { bg: "bg-rose-50", text: "text-rose-800", ring: "ring-rose-600/25" },
  inhaler: { bg: "bg-sky-50", text: "text-sky-800", ring: "ring-sky-600/20" },
  cream: { bg: "bg-purple-50", text: "text-purple-800", ring: "ring-purple-600/20" },
  ointment: { bg: "bg-fuchsia-50", text: "text-fuchsia-800", ring: "ring-fuchsia-600/20" },
  drops: { bg: "bg-cyan-50", text: "text-cyan-800", ring: "ring-cyan-600/20" },
  sachet: { bg: "bg-emerald-50", text: "text-emerald-800", ring: "ring-emerald-600/20" },
};

const LOW_STOCK = 10;

type FilterMode = "all" | "low" | "out" | string;
type SortMode = "name-asc" | "stock-asc" | "stock-desc" | "price-desc" | "margin-desc";

const emptyForm = {
  name: "",
  strength: "",
  form: "tablet",
  unitPrice: "",
  costPrice: "",
  stock: "",
};

export default function MedicinesPage() {
  const data = useClinic();
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sortMode, setSortMode] = useState<SortMode>("name-asc");
  const [isEditModeUnlocked, setIsEditModeUnlocked] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [bulkAdjustModalOpen, setBulkAdjustModalOpen] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState<Medicine | null>(null);

  // Summary Metrics
  const metrics = useMemo(() => {
    const totalItems = data.medicines.length;
    const lowStockItems = data.medicines.filter((m) => m.stock > 0 && m.stock <= LOW_STOCK);
    const outOfStockItems = data.medicines.filter((m) => m.stock === 0);
    const totalCostValue = data.medicines.reduce((s, m) => s + m.stock * (m.costPrice || 0), 0);
    const totalRetailValue = data.medicines.reduce((s, m) => s + m.stock * m.unitPrice, 0);
    const totalPotentialProfit = totalRetailValue - totalCostValue;
    const avgMarginPct =
      totalRetailValue > 0 ? (totalPotentialProfit / totalRetailValue) * 100 : 0;

    return {
      totalItems,
      lowStockCount: lowStockItems.length,
      outOfStockCount: outOfStockItems.length,
      totalCostValue,
      totalRetailValue,
      totalPotentialProfit,
      avgMarginPct,
    };
  }, [data.medicines]);

  // Filtered & Sorted Medicines
  const filteredMedicines = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = data.medicines.filter((m) => {
      const matchesQuery =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.strength.toLowerCase().includes(q) ||
        m.form.toLowerCase().includes(q);

      if (!matchesQuery) return false;

      if (filterMode === "low") return m.stock > 0 && m.stock <= LOW_STOCK;
      if (filterMode === "out") return m.stock === 0;
      if (filterMode !== "all") return m.form.toLowerCase() === filterMode;

      return true;
    });

    list = [...list].sort((a, b) => {
      switch (sortMode) {
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "stock-asc":
          return a.stock - b.stock;
        case "stock-desc":
          return b.stock - a.stock;
        case "price-desc":
          return b.unitPrice - a.unitPrice;
        case "margin-desc": {
          const marginA = a.unitPrice - (a.costPrice || 0);
          const marginB = b.unitPrice - (b.costPrice || 0);
          return marginB - marginA;
        }
        default:
          return 0;
      }
    });

    return list;
  }, [data.medicines, search, filterMode, sortMode]);

  // Export current catalog as CSV
  const handleExportCatalog = () => {
    const headers = ["Name", "Strength", "Form", "CostPrice", "SellingPrice", "Stock", "UnitMargin", "MarginPct"];
    const rows = data.medicines.map((m) => {
      const margin = m.unitPrice - (m.costPrice || 0);
      const marginPct = m.unitPrice > 0 ? Math.round((margin / m.unitPrice) * 100) : 0;
      return [
        `"${m.name.replace(/"/g, '""')}"`,
        `"${(m.strength || "").replace(/"/g, '""')}"`,
        m.form,
        m.costPrice || 0,
        m.unitPrice,
        m.stock,
        margin,
        `${marginPct}%`,
      ].join(",");
    });
    const csvContent = [headers.join(","), ...rows].join("\n");
    downloadCsv(`careflow-pharmacy-catalog-${new Date().toISOString().split("T")[0]}.csv`, csvContent);
  };

  return (
    <div className="space-y-6">
      {/* Header & Top Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-teal-950 sm:text-3xl">
            Pharmacy & Medication Catalog
          </h1>
          <p className="text-xs font-medium text-zinc-500 sm:text-sm">
            Edit individual medications in detail, toggle bulk edit across all rows, or import goods from Excel/CSV manifests.
          </p>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Edit All Mode Toggle */}
          <button
            onClick={() => setIsEditModeUnlocked((prev) => !prev)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition-all border",
              isEditModeUnlocked
                ? "bg-amber-50 border-amber-300 text-amber-900 shadow-xs"
                : "bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50",
            )}
            title={isEditModeUnlocked ? "Lock table" : "Unlock all rows for quick inline edits"}
          >
            {isEditModeUnlocked ? (
              <>
                <UnlockIcon className="size-3.5 text-amber-700" />
                <span>Bulk Edit: Active</span>
              </>
            ) : (
              <>
                <LockIcon className="size-3.5 text-zinc-500" />
                <span>Bulk Edit: Locked</span>
              </>
            )}
          </button>

          {/* Bulk Price Adjustment Tool */}
          <button
            onClick={() => setBulkAdjustModalOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-xs hover:bg-teal-50 hover:text-teal-900 transition-colors"
          >
            <SlidersHorizontalIcon className="size-3.5 text-teal-700" />
            <span>Bulk Price Adjust</span>
          </button>

          {/* Import Excel / CSV */}
          <button
            onClick={() => setImportModalOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-teal-800 px-3.5 text-xs font-semibold text-white shadow-sm shadow-teal-950/20 hover:bg-teal-900 transition-all active:scale-[0.98]"
          >
            <FileSpreadsheetIcon className="size-4" />
            <span>Import Goods (Excel/CSV)</span>
          </button>

          {/* Export Catalog */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportCatalog}
            className="h-9 gap-2 rounded-xl text-xs font-semibold"
          >
            <DownloadIcon className="size-3.5 text-zinc-600" />
            <span>Export CSV</span>
          </Button>
        </div>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Total Catalog Items */}
        <div className="rounded-2xl border border-teal-950/10 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Catalog Products
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-800">
              <PillIcon className="size-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
            {metrics.totalItems}
          </p>
          <p className="mt-1 text-xs text-zinc-400">Active formulary lines</p>
        </div>

        {/* Total Inventory Valuation */}
        <div className="rounded-2xl border border-teal-950/10 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Valuation at Cost
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
              <DollarSignIcon className="size-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
            {money(metrics.totalCostValue)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {money(metrics.totalRetailValue)} retail value
          </p>
        </div>

        {/* Expected Inventory Margin */}
        <div className="rounded-2xl border border-teal-950/10 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Avg Gross Margin
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <TrendingUpIcon className="size-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-700 sm:text-3xl">
            {Math.round(metrics.avgMarginPct)}%
          </p>
          <p className="mt-1 text-xs text-emerald-800 font-medium">
            +{money(metrics.totalPotentialProfit)} unrealized profit
          </p>
        </div>

        {/* Critical Stock Alerts */}
        <div
          className={cn(
            "rounded-2xl border p-4 shadow-xs transition-colors",
            metrics.lowStockCount + metrics.outOfStockCount > 0
              ? "border-amber-200 bg-amber-50/50"
              : "border-teal-950/10 bg-white",
          )}
        >
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "text-xs font-semibold uppercase tracking-wider",
                metrics.lowStockCount + metrics.outOfStockCount > 0
                  ? "text-amber-800"
                  : "text-zinc-500",
              )}
            >
              Reorder Alerts
            </span>
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg",
                metrics.lowStockCount + metrics.outOfStockCount > 0
                  ? "bg-amber-100 text-amber-800"
                  : "bg-zinc-100 text-zinc-600",
              )}
            >
              <AlertTriangleIcon className="size-4" />
            </span>
          </div>
          <p
            className={cn(
              "mt-2 text-2xl font-bold tracking-tight sm:text-3xl",
              metrics.lowStockCount + metrics.outOfStockCount > 0
                ? "text-amber-950"
                : "text-zinc-900",
            )}
          >
            {metrics.lowStockCount + metrics.outOfStockCount}
          </p>
          <p
            className={cn(
              "mt-1 text-xs",
              metrics.lowStockCount + metrics.outOfStockCount > 0
                ? "text-amber-800 font-medium"
                : "text-zinc-400",
            )}
          >
            {metrics.outOfStockCount} depleted · {metrics.lowStockCount} low stock
          </p>
        </div>
      </div>

      {/* Main Content Layout: Catalog (Left) + Add Medicine Card (Right) */}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Left Side: Catalog Table & Controls */}
        <div className="space-y-3">
          {/* Search, Filter Pills & Sort Bar */}
          <div className="flex flex-col gap-2.5 rounded-2xl border border-teal-950/10 bg-white p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
            {/* Search Input */}
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-2.5 size-4 text-zinc-400" />
              <input
                className={cn(inputClass, "h-9 w-full pl-9 text-xs")}
                placeholder="Search medication name, strength, dosage..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Sort Selector */}
            <div className="flex items-center gap-2">
              <ArrowUpDownIcon className="size-3.5 text-zinc-400" />
              <select
                className={cn(inputClass, "h-9 text-xs py-0 pr-8 font-medium text-zinc-700")}
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
              >
                <option value="name-asc">Name (A → Z)</option>
                <option value="stock-asc">Stock (Lowest First)</option>
                <option value="stock-desc">Stock (Highest First)</option>
                <option value="price-desc">Selling Price (Highest)</option>
                <option value="margin-desc">Profit Margin (Highest)</option>
              </select>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pb-1">
            <button
              onClick={() => setFilterMode("all")}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-all",
                filterMode === "all"
                  ? "bg-teal-800 text-white shadow-xs"
                  : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50",
              )}
            >
              All Items ({data.medicines.length})
            </button>

            {metrics.lowStockCount > 0 && (
              <button
                onClick={() => setFilterMode("low")}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-all",
                  filterMode === "low"
                    ? "bg-amber-700 text-white shadow-xs"
                    : "bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100",
                )}
              >
                ⚠️ Low Stock ({metrics.lowStockCount})
              </button>
            )}

            {metrics.outOfStockCount > 0 && (
              <button
                onClick={() => setFilterMode("out")}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-all",
                  filterMode === "out"
                    ? "bg-red-700 text-white shadow-xs"
                    : "bg-red-50 text-red-900 border border-red-200 hover:bg-red-100",
                )}
              >
                🚫 Out of Stock ({metrics.outOfStockCount})
              </button>
            )}

            {["tablet", "capsule", "syrup", "injection"].map((form) => (
              <button
                key={form}
                onClick={() => setFilterMode(form)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold capitalize transition-all",
                  filterMode === form
                    ? "bg-zinc-800 text-white shadow-xs"
                    : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50",
                )}
              >
                {form}s
              </button>
            ))}
          </div>

          {/* Medicines Table */}
          {filteredMedicines.length === 0 ? (
            <EmptyState>
              {data.medicines.length === 0
                ? "The pharmacy catalog is currently empty — add your first medicine or import goods from Excel/CSV."
                : "No medications match your filter criteria."}
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-teal-950/10 bg-white shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-left text-xs">
                  <thead className="border-b border-zinc-200 bg-zinc-50/80 text-zinc-500">
                    <tr>
                      <th className="py-3 pl-4 font-semibold">Medicine & Strength</th>
                      <th className="py-3 font-semibold">Form</th>
                      <th className="py-3 font-semibold">Cost Price</th>
                      <th className="py-3 font-semibold">Selling Price</th>
                      <th className="py-3 font-semibold">Unit Margin</th>
                      <th className="py-3 font-semibold">In Stock</th>
                      <th className="py-3 pr-4 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredMedicines.map((m) => (
                      <MedicineRow
                        key={`${m.id}-${m.name}-${m.strength}-${m.unitPrice}-${m.costPrice}-${m.stock}`}
                        med={m}
                        isUnlocked={isEditModeUnlocked}
                        onEditSingle={() => setEditingMedicine(m)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span>
              {isEditModeUnlocked
                ? "🔓 Edit All Mode: Typing directly in fields will autosave across all rows."
                : "🔒 Click 'Edit' on any row to edit that specific item, or 'Unlock' to batch-edit all."}
            </span>
            <span>Total Shown: {filteredMedicines.length} items</span>
          </div>
        </div>

        {/* Right Side: Add Medicine Card */}
        <div>
          <AddMedicineForm />
        </div>
      </div>

      {/* ========================================================= */}
      {/* 1. EDIT SPECIFIC MEDICINE MODAL                           */}
      {/* ========================================================= */}
      {editingMedicine && (
        <EditSingleMedicineModal
          medicine={editingMedicine}
          onClose={() => setEditingMedicine(null)}
        />
      )}

      {/* ========================================================= */}
      {/* 2. BULK PRICE ADJUSTMENT MODAL                            */}
      {/* ========================================================= */}
      {bulkAdjustModalOpen && (
        <BulkPriceAdjustModal
          filteredMedicines={filteredMedicines}
          onClose={() => setBulkAdjustModalOpen(false)}
        />
      )}

      {/* ========================================================= */}
      {/* 3. EXCEL / CSV IMPORT MODAL                               */}
      {/* ========================================================= */}
      {importModalOpen && (
        <ImportGoodsModal
          existingMedicines={data.medicines}
          onClose={() => setImportModalOpen(false)}
        />
      )}
    </div>
  );
}

/** One catalog row with inline editing (when unlocked), single edit button, and quick restock stepper. */
function MedicineRow({
  med,
  isUnlocked,
  onEditSingle,
}: {
  med: Medicine;
  isUnlocked: boolean;
  onEditSingle: () => void;
}) {
  const [price, setPrice] = useState(String(med.unitPrice));
  const [cost, setCost] = useState(String(med.costPrice || 0));
  const [stock, setStock] = useState(String(med.stock));
  const [savedStatus, setSavedStatus] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const numericCost = Number(cost) || 0;
  const numericPrice = Number(price) || 0;
  const unitProfit = numericPrice - numericCost;
  const marginPct = numericPrice > 0 ? Math.round((unitProfit / numericPrice) * 100) : 0;

  const save = async () => {
    setError(null);
    const changes: { unitPrice?: number; costPrice?: number; stock?: number } = {};
    if (price.trim() !== String(med.unitPrice)) {
      changes.unitPrice = Number(price);
    }
    if (cost.trim() !== String(med.costPrice || 0)) {
      changes.costPrice = Number(cost);
    }
    if (stock.trim() !== String(med.stock)) {
      changes.stock = Number(stock);
    }
    if (Object.keys(changes).length === 0) return;

    const err = await updateMedicine(med.id, changes);
    if (err) {
      setError(err);
    } else {
      setSavedStatus(true);
      setTimeout(() => setSavedStatus(false), 2000);
    }
  };

  const quickAddStock = async (delta: number) => {
    const nextStock = Math.max(0, med.stock + delta);
    setStock(String(nextStock));
    await updateMedicine(med.id, { stock: nextStock });
    setSavedStatus(true);
    setTimeout(() => setSavedStatus(false), 2000);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  };

  const formStyle = FORM_STYLES[med.form.toLowerCase()] ?? FORM_STYLES.tablet;

  return (
    <tr className="hover:bg-teal-50/40 transition-colors">
      {/* Medicine name and strength */}
      <td className="py-3 pl-4">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-zinc-900">{med.name}</span>
          {med.strength && (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
              {med.strength}
            </span>
          )}
          {savedStatus && (
            <span className="text-[10px] font-semibold text-emerald-600 animate-in fade-in">
              ✓ Saved
            </span>
          )}
        </div>
        {error && <p className="mt-1 text-[11px] font-medium text-red-600">{error}</p>}
      </td>

      {/* Form badge */}
      <td className="py-3">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ring-1 ring-inset",
            formStyle.bg,
            formStyle.text,
            formStyle.ring,
          )}
        >
          {med.form}
        </span>
      </td>

      {/* Cost price */}
      <td className="py-3">
        {isUnlocked ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-400 font-mono">KSh</span>
            <input
              className={cn(inputClass, "h-8 w-24 text-xs font-medium tabular-nums")}
              type="number"
              min="0"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              onBlur={save}
              onKeyDown={onKey}
              aria-label={`Cost price of ${med.name}`}
            />
          </div>
        ) : (
          <span className="font-mono text-zinc-600 tabular-nums">
            {money(med.costPrice || 0)}
          </span>
        )}
      </td>

      {/* Selling price */}
      <td className="py-3">
        {isUnlocked ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-400 font-mono">KSh</span>
            <input
              className={cn(inputClass, "h-8 w-24 text-xs font-bold text-teal-950 tabular-nums")}
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={save}
              onKeyDown={onKey}
              aria-label={`Selling price of ${med.name}`}
            />
          </div>
        ) : (
          <span className="font-bold text-teal-950 tabular-nums font-mono">
            {money(med.unitPrice)}
          </span>
        )}
      </td>

      {/* Calculated profit margin */}
      <td className="py-3">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums",
            unitProfit > 0
              ? "bg-emerald-50 text-emerald-800"
              : unitProfit === 0
                ? "bg-zinc-100 text-zinc-600"
                : "bg-red-50 text-red-700",
          )}
        >
          {unitProfit >= 0 ? `+${money(unitProfit)}` : money(unitProfit)}
          <span className="text-[10px] font-normal opacity-80">({marginPct}%)</span>
        </span>
      </td>

      {/* Stock on hand */}
      <td className="py-3">
        <div className="flex items-center gap-2">
          {isUnlocked ? (
            <>
              <input
                className={cn(
                  inputClass,
                  "h-8 w-20 text-xs font-bold tabular-nums",
                  med.stock === 0
                    ? "border-red-400 bg-red-50 text-red-900"
                    : med.stock <= LOW_STOCK
                      ? "border-amber-400 bg-amber-50 text-amber-900"
                      : "text-zinc-900",
                )}
                type="number"
                min="0"
                step="1"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                onBlur={save}
                onKeyDown={onKey}
                aria-label={`Stock of ${med.name}`}
              />

              <div className="flex items-center gap-1">
                <button
                  onClick={() => quickAddStock(10)}
                  title="Add 10 units"
                  className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-1 text-[10px] font-bold text-zinc-600 hover:bg-teal-50 hover:text-teal-900"
                >
                  +10
                </button>
                <button
                  onClick={() => quickAddStock(50)}
                  title="Add 50 units"
                  className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-1 text-[10px] font-bold text-zinc-600 hover:bg-teal-50 hover:text-teal-900"
                >
                  +50
                </button>
              </div>
            </>
          ) : (
            <span
              className={cn(
                "font-bold tabular-nums",
                med.stock === 0
                  ? "text-red-700"
                  : med.stock <= LOW_STOCK
                    ? "text-amber-800"
                    : "text-zinc-900",
              )}
            >
              {med.stock} units
            </span>
          )}
        </div>

        {med.stock <= LOW_STOCK && (
          <p
            className={cn(
              "mt-1 text-[10px] font-bold",
              med.stock === 0 ? "text-red-700" : "text-amber-800",
            )}
          >
            {med.stock === 0 ? "● Depleted (Out of Stock)" : `● Low Stock (${med.stock} left)`}
          </p>
        )}
      </td>

      {/* Row Edit Action */}
      <td className="py-3 pr-4 text-right">
        <button
          onClick={onEditSingle}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-2xs hover:border-teal-700/30 hover:bg-teal-50 hover:text-teal-900 transition-all"
        >
          <Edit3Icon className="size-3 text-teal-700" />
          <span>Edit</span>
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// 1. EDIT SINGLE SPECIFIC MEDICINE MODAL
// ---------------------------------------------------------------------------
function EditSingleMedicineModal({
  medicine,
  onClose,
}: {
  medicine: Medicine;
  onClose: () => void;
}) {
  const [name, setName] = useState(medicine.name);
  const [strength, setStrength] = useState(medicine.strength || "");
  const [form, setForm] = useState(medicine.form);
  const [costPrice, setCostPrice] = useState(String(medicine.costPrice || 0));
  const [unitPrice, setUnitPrice] = useState(String(medicine.unitPrice));
  const [stockMode, setStockMode] = useState<"set" | "add">("set");
  const [stockValue, setStockValue] = useState(String(medicine.stock));
  const [addQty, setAddQty] = useState("0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numericCost = Number(costPrice) || 0;
  const numericPrice = Number(unitPrice) || 0;
  const unitProfit = numericPrice - numericCost;
  const marginPct = numericPrice > 0 ? Math.round((unitProfit / numericPrice) * 100) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const finalStock =
      stockMode === "add"
        ? Math.max(0, medicine.stock + (Number(addQty) || 0))
        : Math.max(0, Number(stockValue) || 0);

    const err = await updateMedicine(medicine.id, {
      name: name.trim(),
      strength: strength.trim(),
      form,
      costPrice: numericCost,
      unitPrice: numericPrice,
      stock: finalStock,
    });

    setLoading(false);
    if (err) {
      setError(err);
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-teal-950/60 backdrop-blur-xs animate-in fade-in">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl border border-teal-950/15">
        <div className="flex items-center justify-between border-b border-zinc-200 bg-teal-950 px-6 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-800 text-teal-100">
              <Edit3Icon className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-bold">Edit Medication Details</h2>
              <p className="text-xs text-teal-200/80">Updating {medicine.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-teal-300 hover:text-white">
            <XIcon className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <Field label="Generic / Brand Name">
            <input
              className={cn(inputClass, "h-9 text-xs")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Strength / Dosage">
              <input
                className={cn(inputClass, "h-9 text-xs")}
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                placeholder="e.g. 500mg"
              />
            </Field>

            <Field label="Formulation">
              <select
                className={cn(inputClass, "h-9 text-xs capitalize py-0")}
                value={form}
                onChange={(e) => setForm(e.target.value)}
              >
                {FORMS.map((f) => (
                  <option key={f} value={f} className="capitalize">
                    {f}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Supplier Cost (KSh)">
              <input
                className={cn(inputClass, "h-9 text-xs")}
                type="number"
                min="0"
                step="0.01"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
              />
            </Field>

            <Field label="Selling Price (KSh)">
              <input
                className={cn(inputClass, "h-9 text-xs font-bold text-teal-950")}
                type="number"
                min="0"
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                required
              />
            </Field>
          </div>

          {/* Profit Preview */}
          <div className="rounded-xl border border-teal-600/20 bg-teal-50/60 p-3 flex items-center justify-between">
            <span className="text-zinc-600">Unit Profit Margin:</span>
            <span className="font-bold text-teal-950">
              {unitProfit >= 0 ? `+${money(unitProfit)}` : money(unitProfit)} ({marginPct}% margin)
            </span>
          </div>

          {/* Stock Adjustment Section */}
          <div className="space-y-2 border-t border-zinc-100 pt-3">
            <label className="text-xs font-bold text-zinc-700">Stock on Hand</label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="stockMode"
                  checked={stockMode === "set"}
                  onChange={() => setStockMode("set")}
                  className="accent-teal-700"
                />
                <span>Set exact quantity</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="stockMode"
                  checked={stockMode === "add"}
                  onChange={() => setStockMode("add")}
                  className="accent-teal-700"
                />
                <span>+ Restock (add to current {medicine.stock})</span>
              </label>
            </div>

            {stockMode === "set" ? (
              <input
                className={cn(inputClass, "h-9 w-full text-xs font-bold")}
                type="number"
                min="0"
                value={stockValue}
                onChange={(e) => setStockValue(e.target.value)}
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-500">+</span>
                <input
                  className={cn(inputClass, "h-9 w-full text-xs font-bold")}
                  type="number"
                  min="0"
                  placeholder="Units to add, e.g. 50"
                  value={addQty}
                  onChange={(e) => setAddQty(e.target.value)}
                />
                <span className="text-xs text-zinc-500 whitespace-nowrap">
                  = {medicine.stock + (Number(addQty) || 0)} total units
                </span>
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 p-3 text-xs font-medium text-red-700">{error}</p>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-100">
            <Button variant="ghost" size="sm" type="button" onClick={onClose} className="rounded-xl text-xs">
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={loading} className="rounded-xl text-xs font-bold px-5">
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. BULK PRICE ADJUSTMENT MODAL (Percentage / Flat Markup across all items)
// ---------------------------------------------------------------------------
function BulkPriceAdjustModal({
  filteredMedicines,
  onClose,
}: {
  filteredMedicines: Medicine[];
  onClose: () => void;
}) {
  const [type, setType] = useState<"percentage" | "flat">("percentage");
  const [target, setTarget] = useState<"selling" | "cost">("selling");
  const [value, setValue] = useState("10");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async () => {
    if (filteredMedicines.length === 0) return;
    setLoading(true);
    setError(null);

    const numericVal = Number(value) || 0;

    for (const med of filteredMedicines) {
      if (target === "selling") {
        let newPrice = med.unitPrice;
        if (type === "percentage") {
          newPrice = Math.max(0, Math.round(med.unitPrice * (1 + numericVal / 100)));
        } else {
          newPrice = Math.max(0, med.unitPrice + numericVal);
        }
        await updateMedicine(med.id, { unitPrice: newPrice });
      } else {
        let newCost = med.costPrice || 0;
        if (type === "percentage") {
          newCost = Math.max(0, Math.round(newCost * (1 + numericVal / 100)));
        } else {
          newCost = Math.max(0, newCost + numericVal);
        }
        await updateMedicine(med.id, { costPrice: newCost });
      }
    }

    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-teal-950/60 backdrop-blur-xs animate-in fade-in">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl border border-teal-950/15">
        <div className="flex items-center justify-between border-b border-zinc-200 bg-teal-950 px-6 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-800 text-teal-100">
              <SlidersHorizontalIcon className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-bold">Bulk Price Adjustment</h2>
              <p className="text-xs text-teal-200/80">
                Applying to {filteredMedicines.length} currently filtered items
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-teal-300 hover:text-white">
            <XIcon className="size-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-xs">
          <Field label="Adjustment Target">
            <select
              className={cn(inputClass, "h-9 text-xs")}
              value={target}
              onChange={(e) => setTarget(e.target.value as "selling" | "cost")}
            >
              <option value="selling">Selling Price (POS Retail)</option>
              <option value="cost">Supplier Cost Price</option>
            </select>
          </Field>

          <Field label="Adjustment Type">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType("percentage")}
                className={cn(
                  "rounded-xl p-2.5 text-center font-bold border text-xs transition-all",
                  type === "percentage"
                    ? "bg-teal-800 text-white border-teal-800"
                    : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50",
                )}
              >
                Percentage (%) Markup
              </button>
              <button
                type="button"
                onClick={() => setType("flat")}
                className={cn(
                  "rounded-xl p-2.5 text-center font-bold border text-xs transition-all",
                  type === "flat"
                    ? "bg-teal-800 text-white border-teal-800"
                    : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50",
                )}
              >
                Fixed Amount (KSh)
              </button>
            </div>
          </Field>

          <Field label={type === "percentage" ? "Percentage (+ or - %)" : "Amount in KSh (+ or -)"}>
            <input
              className={cn(inputClass, "h-9 text-xs font-bold")}
              type="number"
              step={type === "percentage" ? "1" : "0.5"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. 10"
            />
          </Field>

          <p className="text-[11px] text-zinc-500 rounded-xl bg-zinc-50 p-3 border border-zinc-200">
            Example: An item currently priced at <strong>KSh 100</strong> will be updated to{" "}
            <strong>
              {money(
                type === "percentage"
                  ? Math.max(0, 100 * (1 + (Number(value) || 0) / 100))
                  : Math.max(0, 100 + (Number(value) || 0)),
              )}
            </strong>
            .
          </p>

          {error && <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-100">
            <Button variant="ghost" size="sm" onClick={onClose} className="rounded-xl text-xs">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={loading}
              className="rounded-xl text-xs font-bold px-5"
            >
              {loading ? (
                <>
                  <Spinner className="size-3.5 mr-1" />
                  Updating...
                </>
              ) : (
                `Apply to ${filteredMedicines.length} Items`
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. EXCEL / CSV IMPORT MODAL COMPONENT
// ---------------------------------------------------------------------------
interface ParsedImportRow {
  name: string;
  strength: string;
  form: string;
  costPrice: number;
  unitPrice: number;
  stock: number;
  isExisting: boolean;
  isValid: boolean;
  error?: string;
}

function ImportGoodsModal({
  existingMedicines,
  onClose,
}: {
  existingMedicines: Medicine[];
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedImportRow[]>([]);
  const [mode, setMode] = useState<"add_or_update" | "add_only">("add_or_update");
  const [loading, setLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; updated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadTemplate = () => {
    const headers = "Name,Strength,Form,CostPrice,SellingPrice,Quantity";
    const sampleRows = [
      "Amoxicillin,500mg,capsule,8.50,15.00,100",
      "Paracetamol,500mg,tablet,2.00,5.00,500",
      "Ibuprofen,400mg,tablet,4.00,10.00,200",
      "Cough Syrup,100ml,syrup,120.00,200.00,50",
      "Salbutamol,100mcg,inhaler,350.00,550.00,30",
      "Hydrocortisone,1%,cream,80.00,150.00,40",
    ];
    downloadCsv("careflow-goods-import-template.csv", [headers, ...sampleRows].join("\n"));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setImportResult(null);
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) throw new Error("File appears to be empty.");

        const lines = text
          .split(/\r\n|\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        if (lines.length < 2) {
          throw new Error("File must contain a header row and at least one medication record.");
        }

        const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));
        const nameIdx = headers.findIndex((h) => h.includes("name") || h.includes("medicine") || h.includes("item"));
        const strengthIdx = headers.findIndex((h) => h.includes("strength") || h.includes("dose") || h.includes("dosage"));
        const formIdx = headers.findIndex((h) => h.includes("form") || h.includes("type"));
        const costIdx = headers.findIndex((h) => h.includes("cost") || h.includes("buying"));
        const priceIdx = headers.findIndex((h) => h.includes("price") || h.includes("selling") || h.includes("unit"));
        const stockIdx = headers.findIndex((h) => h.includes("stock") || h.includes("qty") || h.includes("quantity"));

        if (nameIdx === -1) {
          throw new Error("Could not find a 'Name' column in header. Please use the sample template.");
        }

        const existingMap = new Set(
          existingMedicines.map((m) => `${m.name.trim().toLowerCase()}::${(m.strength || "").trim().toLowerCase()}`),
        );

        const rows: ParsedImportRow[] = [];

        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
          const name = cols[nameIdx] ?? "";
          if (!name) continue;

          const strength = strengthIdx !== -1 ? cols[strengthIdx] ?? "" : "";
          const form = formIdx !== -1 ? (cols[formIdx] || "tablet").toLowerCase() : "tablet";
          const costPrice = costIdx !== -1 ? Math.max(0, Number(cols[costIdx]) || 0) : 0;
          const unitPrice = priceIdx !== -1 ? Math.max(0, Number(cols[priceIdx]) || 0) : 0;
          const stock = stockIdx !== -1 ? Math.max(0, Math.round(Number(cols[stockIdx]) || 0)) : 0;

          const key = `${name.toLowerCase()}::${strength.toLowerCase()}`;
          const isExisting = existingMap.has(key);
          const isValid = Boolean(name) && unitPrice >= 0;

          rows.push({
            name,
            strength,
            form: FORMS.includes(form) ? form : "tablet",
            costPrice,
            unitPrice,
            stock,
            isExisting,
            isValid,
          });
        }

        if (rows.length === 0) {
          throw new Error("No valid data rows could be extracted from this file.");
        }

        setParsedRows(rows);
      } catch (err: any) {
        console.error("CSV parse error", err);
        setError(err.message || "Failed to parse CSV file. Please verify formatting.");
      }
    };

    reader.readAsText(selectedFile);
  };

  const handleExecuteImport = async () => {
    if (parsedRows.length === 0) return;
    setLoading(true);
    setError(null);

    const payload = parsedRows.map((r) => ({
      name: r.name,
      strength: r.strength,
      form: r.form,
      costPrice: r.costPrice,
      unitPrice: r.unitPrice,
      stock: r.stock,
    }));

    const err = await importMedicines({ items: payload, mode });
    setLoading(false);

    if (err) {
      setError(err);
    } else {
      const newCount = parsedRows.filter((r) => !r.isExisting).length;
      const updatedCount = parsedRows.filter((r) => r.isExisting).length;
      setImportResult({ added: newCount, updated: updatedCount });
    }
  };

  const totalBatchCost = parsedRows.reduce((s, r) => s + r.stock * r.costPrice, 0);
  const totalBatchRetail = parsedRows.reduce((s, r) => s + r.stock * r.unitPrice, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-teal-950/60 backdrop-blur-xs animate-in fade-in">
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl border border-teal-950/15">
        <div className="flex items-center justify-between border-b border-zinc-200 bg-teal-950 px-6 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-800 text-teal-100">
              <FileSpreadsheetIcon className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-bold">Import Goods & Batch Restock</h2>
              <p className="text-xs text-teal-200/80">
                Bulk upload medication stock, supplier prices, and new product lines from Excel/CSV
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-teal-300 hover:bg-teal-900 hover:text-white transition-colors"
          >
            <XIcon className="size-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-dashed border-teal-700/30 bg-teal-50/40">
            <div>
              <p className="text-xs font-bold text-teal-950">Standard Import Format</p>
              <p className="text-[11px] text-zinc-500">
                Columns: <code>Name, Strength, Form, CostPrice, SellingPrice, Quantity</code>
              </p>
            </div>
            <button
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 rounded-xl border border-teal-700/30 bg-white px-3 py-1.5 text-xs font-semibold text-teal-900 shadow-xs hover:bg-teal-50"
            >
              <DownloadIcon className="size-3.5 text-teal-700" />
              Download Sample CSV Template
            </button>
          </div>

          {!importResult && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-700">Select CSV / Excel File</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,application/vnd.ms-excel"
                onChange={handleFileChange}
                className="block w-full text-xs text-zinc-600 file:mr-3 file:rounded-xl file:border-0 file:bg-teal-800 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-teal-900 file:cursor-pointer"
              />
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-red-50 p-3.5 text-xs font-medium text-red-800 border border-red-200">
              {error}
            </div>
          )}

          {parsedRows.length > 0 && !importResult && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
                <div>
                  <h3 className="text-xs font-bold text-zinc-900">
                    File Verification Preview ({parsedRows.length} items detected)
                  </h3>
                  <p className="text-[11px] text-zinc-500">
                    New items: {parsedRows.filter((r) => !r.isExisting).length} · Restock existing:{" "}
                    {parsedRows.filter((r) => r.isExisting).length}
                  </p>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <div className="rounded-lg bg-zinc-100 px-2.5 py-1 text-zinc-700 font-medium">
                    Batch Cost: <strong>{money(totalBatchCost)}</strong>
                  </div>
                  <div className="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-800 font-medium">
                    Retail: <strong>{money(totalBatchRetail)}</strong>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs font-medium text-zinc-700 bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <span className="font-semibold text-zinc-900">Import Strategy:</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={mode === "add_or_update"}
                    onChange={() => setMode("add_or_update")}
                    className="accent-teal-700"
                  />
                  <span>Smart Restock & Add (Increases stock of existing items)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={mode === "add_only"}
                    onChange={() => setMode("add_only")}
                    className="accent-teal-700"
                  />
                  <span>New Items Only (Skip existing)</span>
                </label>
              </div>

              <div className="max-h-56 overflow-y-auto rounded-xl border border-zinc-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-zinc-100 text-zinc-600 border-b border-zinc-200">
                    <tr>
                      <th className="py-2 pl-3 font-semibold">Status</th>
                      <th className="py-2 font-semibold">Medicine</th>
                      <th className="py-2 font-semibold">Form</th>
                      <th className="py-2 text-right font-semibold">Cost</th>
                      <th className="py-2 text-right font-semibold">Selling</th>
                      <th className="py-2 pr-3 text-right font-semibold">Import Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {parsedRows.slice(0, 30).map((r, i) => (
                      <tr key={i} className="hover:bg-teal-50/40">
                        <td className="py-2 pl-3">
                          {r.isExisting ? (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                              Restock
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                              + New
                            </span>
                          )}
                        </td>
                        <td className="py-2 font-semibold text-zinc-900">
                          {r.name} {r.strength && <span className="text-zinc-500 font-normal">({r.strength})</span>}
                        </td>
                        <td className="py-2 capitalize text-zinc-600">{r.form}</td>
                        <td className="py-2 text-right font-mono text-zinc-600">{money(r.costPrice)}</td>
                        <td className="py-2 text-right font-mono font-bold text-teal-950">{money(r.unitPrice)}</td>
                        <td className="py-2 pr-3 text-right font-bold tabular-nums text-zinc-900">{r.stock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {importResult && (
            <div className="p-6 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-3 animate-in fade-in">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
                <FileCheckIcon className="size-6" />
              </span>
              <h3 className="text-base font-bold text-emerald-950">
                Inventory Import Completed Successfully!
              </h3>
              <p className="text-xs text-emerald-800">
                Processed <strong>{parsedRows.length}</strong> items: <strong>{importResult.added}</strong> new medicines created and <strong>{importResult.updated}</strong> existing items restocked.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-zinc-200 bg-zinc-50 px-6 py-3.5">
          <Button variant="ghost" size="sm" onClick={onClose} className="rounded-xl text-xs">
            {importResult ? "Close" : "Cancel"}
          </Button>

          {!importResult && parsedRows.length > 0 && (
            <Button
              size="sm"
              onClick={handleExecuteImport}
              disabled={loading}
              className="rounded-xl text-xs font-bold gap-2 px-5"
            >
              {loading ? (
                <>
                  <Spinner className="size-3.5" />
                  <span>Processing Batch...</span>
                </>
              ) : (
                <>
                  <UploadIcon className="size-3.5" />
                  <span>Import & Restock {parsedRows.length} Items</span>
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Form for onboarding new medications */
function AddMedicineForm() {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const set =
    (k: keyof typeof form) => (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const cost = Number(form.costPrice) || 0;
  const price = Number(form.unitPrice) || 0;
  const qty = Number(form.stock) || 0;
  const unitProfit = price - cost;
  const marginPct = price > 0 ? Math.round((unitProfit / price) * 100) : 0;
  const batchRetail = price * qty;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(null);

    const err = await addMedicine({
      name: form.name.trim(),
      strength: form.strength.trim(),
      form: form.form,
      unitPrice: Number(form.unitPrice),
      costPrice: Number(form.costPrice) || 0,
      stock: Number(form.stock) || 0,
    });

    if (err) {
      setError(err);
      return;
    }

    setSaved(`${form.name.trim()} ${form.strength.trim()}`.trim());
    setForm(emptyForm);
  };

  return (
    <Card className="p-5 sticky top-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-800 text-white">
          <PlusIcon className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-zinc-900">Add New Medication</h2>
          <p className="text-[11px] text-zinc-400">Onboard into pharmacy catalog</p>
        </div>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3.5 text-xs">
        <Field label="Medicine Generic / Brand Name">
          <input
            className={cn(inputClass, "h-9 text-xs")}
            value={form.name}
            onChange={set("name")}
            placeholder="e.g. Amoxicillin, Paracetamol..."
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Strength / Dosage">
            <input
              className={cn(inputClass, "h-9 text-xs")}
              value={form.strength}
              onChange={set("strength")}
              placeholder="e.g. 500mg, 20ml"
            />
          </Field>

          <Field label="Formulation">
            <select
              className={cn(inputClass, "h-9 text-xs capitalize py-0")}
              value={form.form}
              onChange={set("form")}
            >
              {FORMS.map((f) => (
                <option key={f} value={f} className="capitalize">
                  {f}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Supplier Cost (KSh)">
            <input
              className={cn(inputClass, "h-9 text-xs")}
              type="number"
              min="0"
              step="0.01"
              value={form.costPrice}
              onChange={set("costPrice")}
              placeholder="e.g. 6.00"
            />
          </Field>

          <Field label="Selling Price (KSh)">
            <input
              className={cn(inputClass, "h-9 text-xs font-bold text-teal-950")}
              type="number"
              min="0"
              step="0.01"
              value={form.unitPrice}
              onChange={set("unitPrice")}
              placeholder="e.g. 10.00"
              required
            />
          </Field>
        </div>

        {/* Live Margin Calculation Preview */}
        {price > 0 && (
          <div className="rounded-xl border border-teal-600/20 bg-teal-50/60 p-3 space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-zinc-600">Unit Profit:</span>
              <span className="font-bold text-teal-900">
                {unitProfit >= 0 ? `+${money(unitProfit)}` : money(unitProfit)} ({marginPct}% margin)
              </span>
            </div>
            {qty > 0 && (
              <div className="flex items-center justify-between text-[11px] border-t border-teal-900/10 pt-1">
                <span className="text-zinc-600">Batch Value ({qty} units):</span>
                <span className="font-semibold text-zinc-900">{money(batchRetail)}</span>
              </div>
            )}
          </div>
        )}

        <Field label="Opening Stock Units">
          <input
            className={cn(inputClass, "h-9 text-xs font-medium")}
            type="number"
            min="0"
            step="1"
            value={form.stock}
            onChange={set("stock")}
            placeholder="e.g. 100 units"
          />
        </Field>

        {error && (
          <p className="rounded-xl bg-red-50 p-3 text-xs font-medium text-red-700">
            {error}
          </p>
        )}

        {saved && (
          <p className="rounded-xl bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
            ✓ Successfully added <strong>{saved}</strong> to the pharmacy catalog.
          </p>
        )}

        <Button type="submit" className="mt-1 h-9 rounded-xl text-xs font-bold gap-2">
          <PlusIcon className="size-4" />
          Add to Pharmacy Formulary
        </Button>
      </form>
    </Card>
  );
}
