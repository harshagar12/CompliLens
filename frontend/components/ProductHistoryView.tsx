"use client";

import React, { useEffect, useState } from "react";
import {
  listProducts,
  getProductHistory,
  ProductListItem,
  ProductHistory,
  ProductHistoryEntry,
  API_BASE_URL,
} from "../lib/api";
import {
  History,
  Search,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  XCircle,
  Clock,
  Package,
  ArrowRight,
  ExternalLink,
  ShieldAlert,
  Calendar,
  Layers,
  Sparkles,
} from "lucide-react";

interface ProductHistoryViewProps {
  initialProductKey?: string | null;
  onSelectManufacturer?: (mfgKey: string) => void;
}

export const ProductHistoryView: React.FC<ProductHistoryViewProps> = ({
  initialProductKey,
  onSelectManufacturer,
}) => {
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(initialProductKey || null);
  const [history, setHistory] = useState<ProductHistory | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Load products list
  useEffect(() => {
    loadProducts();
  }, []);

  // Update selected product if prop changes
  useEffect(() => {
    if (initialProductKey) {
      setSelectedProductKey(initialProductKey);
    }
  }, [initialProductKey]);

  // Load history whenever selected product changes
  useEffect(() => {
    if (selectedProductKey) {
      loadHistory(selectedProductKey);
    }
  }, [selectedProductKey]);

  const loadProducts = async () => {
    setIsLoadingList(true);
    try {
      const data = await listProducts();
      setProducts(data);
      if (!selectedProductKey && data.length > 0) {
        setSelectedProductKey(data[0].product_key);
      }
    } catch (err) {
      console.error("Failed to load products:", err);
    } finally {
      setIsLoadingList(false);
    }
  };

  const loadHistory = async (key: string) => {
    setIsLoadingHistory(true);
    try {
      const data = await getProductHistory(key);
      setHistory(data);
    } catch (err) {
      console.error("Failed to load history for", key, err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const filteredProducts = products.filter(
    (p) =>
      p.common_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.manufacturer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.product_key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getTrendBadge = (trend: ProductHistory["trend"]) => {
    switch (trend) {
      case "IMPROVING":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <TrendingUp className="w-3.5 h-3.5" /> Improving
          </span>
        );
      case "DEGRADING":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse">
            <TrendingDown className="w-3.5 h-3.5" /> Degrading
          </span>
        );
      case "STABLE":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Minus className="w-3.5 h-3.5" /> Stable
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <Clock className="w-3.5 h-3.5" /> Insufficient Data
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800/80 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <History className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Product History & Lineage
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  PRD §8.2
                </span>
              </h1>
              <p className="text-sm text-slate-400">
                Track statutory compliance evolution, fail count trajectories, and packaging regression events across production revisions.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Sidebar: Product Directory */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 backdrop-blur-sm">
            <div className="relative mb-3">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products or brands..."
                className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <div className="text-xs text-slate-400 px-1 mb-2 font-medium">
              Tracked Products ({filteredProducts.length})
            </div>

            <div className="space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
              {isLoadingList ? (
                <div className="py-8 text-center text-sm text-slate-500 animate-pulse">
                  Loading product catalog...
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  No matching products found.
                </div>
              ) : (
                filteredProducts.map((p) => {
                  const isSelected = p.product_key === selectedProductKey;
                  return (
                    <button
                      key={p.product_key}
                      onClick={() => setSelectedProductKey(p.product_key)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                        isSelected
                          ? "bg-emerald-500/10 border-emerald-500/40 shadow-lg shadow-emerald-500/5"
                          : "bg-slate-950/40 border-slate-800/60 hover:bg-slate-800/40 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm text-slate-100 truncate">
                            {p.common_name}
                          </div>
                          <div className="text-xs text-slate-400 truncate mt-0.5">
                            {p.manufacturer_name}
                          </div>
                        </div>
                        {p.has_active_regression && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 shrink-0 animate-pulse">
                            REGRESSION
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-2.5 text-[11px] text-slate-400">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono">
                          {p.net_quantity || "Std Pack"}
                        </span>
                        <span>•</span>
                        <span>{p.total_inspections} revisions</span>
                        <span>•</span>
                        <span
                          className={`font-semibold ${
                            p.latest_verdict === "PASS"
                              ? "text-emerald-400"
                              : p.latest_verdict === "FAIL"
                              ? "text-rose-400"
                              : "text-amber-400"
                          }`}
                        >
                          {p.latest_verdict}
                        </span>
                      </div>

                      {p.latest_failing_rules && p.latest_failing_rules.length > 0 && (
                        <div className="flex items-center gap-1 mt-2 flex-wrap">
                          {p.latest_failing_rules.slice(0, 3).map((r, rIdx) => (
                            <span
                              key={rIdx}
                              className="px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20 text-[10px] font-mono"
                            >
                              {r.rule_id}
                            </span>
                          ))}
                          {p.latest_failing_rules.length > 3 && (
                            <span className="text-[10px] text-rose-400">
                              +{p.latest_failing_rules.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Main Panel: Product History Details */}
        <div className="lg:col-span-8 space-y-6">
          {isLoadingHistory ? (
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-12 text-center text-slate-400 animate-pulse">
              Loading timeline & regression analysis...
            </div>
          ) : !history ? (
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-12 text-center text-slate-400">
              Select a product from the directory to inspect its statutory history.
            </div>
          ) : (
            <>
              {/* Product Overview Card */}
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm relative overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-white tracking-tight">
                        {history.product_name}
                      </h2>
                      {getTrendBadge(history.trend)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-400 mt-1">
                      <span>Brand/Mfg:</span>
                      <button
                        onClick={() =>
                          onSelectManufacturer && onSelectManufacturer(history.manufacturer_key)
                        }
                        className="text-cyan-400 hover:text-cyan-300 font-medium underline underline-offset-2 flex items-center gap-1"
                      >
                        {history.manufacturer_name}
                        <ExternalLink className="w-3 h-3" />
                      </button>
                      <span>•</span>
                      <span>Pack: {history.net_quantity || "Standard"}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="px-4 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                      <div className="text-xs text-slate-400 font-medium">Revisions</div>
                      <div className="text-lg font-bold text-white">{history.total_inspections}</div>
                    </div>
                    <div className="px-4 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                      <div className="text-xs text-slate-400 font-medium">Fail Rate</div>
                      <div
                        className={`text-lg font-bold ${
                          history.fail_rate > 0.3
                            ? "text-rose-400"
                            : history.fail_rate > 0
                            ? "text-amber-400"
                            : "text-emerald-400"
                        }`}
                      >
                        {(history.fail_rate * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Prominent Regression Alert Banner */}
                {history.has_active_regression && (
                  <div className="mt-5 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5 animate-bounce" />
                    <div>
                      <div className="text-sm font-bold text-rose-300 uppercase tracking-wide">
                        Active Statutory Regression Event Detected (PRD §8.2)
                      </div>
                      <p className="text-xs text-rose-200/90 mt-1">
                        The latest production batch failed one or more Legal Metrology rules that previously passed in earlier revisions. Immediate manufacturer remediation recommended.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Chronological Timeline */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    Inspection Chronology & Field Lineage
                  </h3>
                  <span className="text-xs text-slate-400">Oldest to Newest</span>
                </div>

                <div className="relative pl-6 space-y-6 before:content-[''] before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-800">
                  {history.entries.map((entry, idx) => {
                    const isLatest = idx === history.entries.length - 1;
                    const dateFormatted = new Date(entry.tested_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    });

                    return (
                      <div key={entry.package_id} className="relative">
                        {/* Timeline Node Dot */}
                        <div
                          className={`absolute -left-[27px] top-4 w-4 h-4 rounded-full border-2 ${
                            entry.is_regression
                              ? "bg-rose-500 border-rose-300 ring-4 ring-rose-500/20"
                              : entry.overall_result === "PASS"
                              ? "bg-emerald-500 border-emerald-300"
                              : "bg-amber-500 border-amber-300"
                          }`}
                        />

                        {/* Card */}
                        <div
                          className={`p-5 rounded-2xl border backdrop-blur-sm transition-all ${
                            entry.is_regression
                              ? "bg-rose-950/20 border-rose-500/40 shadow-lg shadow-rose-500/5"
                              : isLatest
                              ? "bg-slate-900/80 border-slate-700 shadow-md"
                              : "bg-slate-900/40 border-slate-800/80"
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/60">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-slate-800 text-slate-200 border border-slate-700">
                                Revision #{idx + 1}
                              </span>
                              <span className="text-xs text-slate-400 flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5" />
                                {dateFormatted}
                              </span>
                              {isLatest && (
                                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  Current Batch
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              {entry.is_regression && (
                                <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                                  REGRESSION
                                </span>
                              )}
                              <span
                                className={`px-2.5 py-0.5 text-xs font-bold rounded-full border ${
                                  entry.overall_result === "PASS"
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : entry.overall_result === "FAIL"
                                    ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                    : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                }`}
                              >
                                {entry.overall_result}
                              </span>
                            </div>
                          </div>

                          {/* Body Content */}
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-4">
                            {/* Label Thumbnail */}
                            {entry.image_url && (
                              <div className="md:col-span-3">
                                <div
                                  onClick={() =>
                                    setPreviewImage(`${API_BASE_URL}${entry.image_url}`)
                                  }
                                  className="group relative cursor-pointer rounded-xl overflow-hidden border border-slate-800 bg-slate-950 aspect-[4/3] flex items-center justify-center"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={`${API_BASE_URL}${entry.image_url}`}
                                    alt={`Revision ${idx + 1}`}
                                    className="object-contain w-full h-full group-hover:scale-105 transition-transform duration-300"
                                    onError={(e) => {
                                      (e.target as HTMLElement).style.display = "none";
                                    }}
                                  />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold">
                                    Click to Enlarge
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Details & Declarations */}
                            <div className={entry.image_url ? "md:col-span-9" : "md:col-span-12"}>
                              <div className="grid grid-cols-3 gap-2 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 mb-3 text-xs">
                                <div>
                                  <span className="text-slate-500 block">MRP</span>
                                  <span className="font-semibold text-slate-200">
                                    {entry.mrp || "N/A"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Net Quantity</span>
                                  <span className="font-semibold text-slate-200">
                                    {entry.net_quantity || "N/A"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Mfg Date</span>
                                  <span className="font-semibold text-slate-200">
                                    {entry.mfg_date || "N/A"}
                                  </span>
                                </div>
                              </div>

                              {/* Regression Details */}
                              {entry.regression_details && entry.regression_details.length > 0 && (
                                <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/50 mb-3 space-y-1">
                                  <div className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                                    Statutory Regressions in this Revision:
                                  </div>
                                  {entry.regression_details.map((reg, i) => (
                                    <div key={i} className="text-xs text-rose-200 pl-5">
                                      • {reg}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Failing Rules / Statutory Non-Compliances */}
                              {entry.failing_rules && entry.failing_rules.length > 0 ? (
                                <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 mb-3 space-y-2.5">
                                  <div className="text-xs font-bold text-rose-300 flex items-center justify-between">
                                    <span className="flex items-center gap-1.5">
                                      <XCircle className="w-4 h-4 text-rose-400" />
                                      Failing Statutory Rules ({entry.failing_rules.length}):
                                    </span>
                                    <span className="text-[10px] text-rose-300 bg-rose-500/20 px-2 py-0.5 rounded border border-rose-500/30 font-semibold">
                                      Action Required
                                    </span>
                                  </div>
                                  <div className="space-y-2 mt-1">
                                    {entry.failing_rules.map((rule, rIdx) => (
                                      <div
                                        key={rIdx}
                                        className="bg-slate-950/80 border border-rose-900/50 rounded-lg p-2.5 text-xs space-y-1"
                                      >
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                                          <div className="flex items-center gap-2">
                                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono font-bold text-[11px] border border-rose-500/30">
                                              {rule.rule_id}
                                            </span>
                                            <span className="font-semibold text-slate-200">
                                              {rule.description}
                                            </span>
                                          </div>
                                          {rule.citation && (
                                            <span className="text-[10px] text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded border border-purple-500/25 shrink-0 self-start sm:self-auto">
                                              {rule.citation}
                                            </span>
                                          )}
                                        </div>

                                        <div className="text-slate-300 pl-1 text-[11px] mt-0.5">
                                          <span className="text-rose-400 font-semibold">Condition failed: </span>
                                          <span>{rule.notes}</span>
                                        </div>

                                        {rule.extracted_value && (
                                          <div className="text-slate-400 pl-1 text-[11px]">
                                            <span className="text-slate-500">Declared Value: </span>
                                            <span className="text-slate-200 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                              &quot;{rule.extracted_value}&quot;
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40 mb-3 flex items-center gap-2 text-xs text-emerald-300">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                  <span>All mandatory Legal Metrology declarations compliant in this batch</span>
                                </div>
                              )}

                              {/* Changed Declarations */}
                              {entry.changed_fields_since_last &&
                                entry.changed_fields_since_last.length > 0 && (
                                  <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400">
                                    <span className="text-slate-500 font-medium">
                                      Changed declarations:
                                    </span>
                                    {entry.changed_fields_since_last.map((fname) => (
                                      <span
                                        key={fname}
                                        className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono text-[11px]"
                                      >
                                        {fname}
                                      </span>
                                    ))}
                                  </div>
                                )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden p-2 relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImage}
              alt="Packaging inspection label preview"
              className="max-h-[85vh] w-auto object-contain rounded-xl mx-auto"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-4 right-4 bg-slate-900/80 hover:bg-slate-800 text-white rounded-full p-2 border border-slate-700 text-xs font-bold"
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
