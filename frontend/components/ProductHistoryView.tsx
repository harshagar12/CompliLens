"use client";

import React, { useEffect, useState } from "react";
import {
  listProducts,
  getProductHistory,
  ProductListItem,
  ProductHistory,
  API_BASE_URL,
} from "@/lib/api";

interface ProductHistoryViewProps {
  initialProductKey?: string | null;
  onSelectManufacturer?: (mfgKey: string) => void;
}

const TrendLabel: React.FC<{ trend: string }> = ({ trend }) => {
  const config: Record<string, { text: string; color: string }> = {
    IMPROVING: { text: "↑ Improving", color: "text-stamp-green" },
    DEGRADING: { text: "↓ Degrading", color: "text-brick" },
    STABLE: { text: "— Stable", color: "text-ink-light" },
    INSUFFICIENT_DATA: { text: "Insufficient data", color: "text-ink-light" },
  };
  const c = config[trend] || config.INSUFFICIENT_DATA;
  return <span className={`text-xs font-medium ${c.color}`}>{c.text}</span>;
};

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

  useEffect(() => { loadProducts(); }, []);

  useEffect(() => {
    if (initialProductKey) setSelectedProductKey(initialProductKey);
  }, [initialProductKey]);

  useEffect(() => {
    if (selectedProductKey) loadHistory(selectedProductKey);
  }, [selectedProductKey]);

  const loadProducts = async () => {
    setIsLoadingList(true);
    try {
      const data = await listProducts();
      setProducts(data);
      if (!selectedProductKey && data.length > 0) setSelectedProductKey(data[0].product_key);
    } catch (err) { console.error(err); }
    finally { setIsLoadingList(false); }
  };

  const loadHistory = async (key: string) => {
    setIsLoadingHistory(true);
    try {
      const data = await getProductHistory(key);
      setHistory(data);
    } catch (err) { console.error(err); }
    finally { setIsLoadingHistory(false); }
  };

  const filteredProducts = products.filter((p) =>
    p.common_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.manufacturer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.product_key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-full flex flex-col space-y-6 pb-4 animate-fadeIn">
      {/* Sleek Studio Header */}
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-hairline">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-heading font-semibold text-ink tracking-tight">
            Product history &amp; lineage
          </h1>
          <span className="text-hairline text-xs hidden sm:inline">&bull;</span>
          <span className="font-mono text-xs text-ink-light">
            {filteredProducts.length} tracked products
          </span>
        </div>
        <div className="w-full sm:w-80">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search products or brands…"
            className="w-full bg-paper border border-hairline rounded-md px-3 py-1.5 text-xs text-ink font-body focus:outline-none focus:border-seal"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-4">
        {/* LEFT: Product Directory */}
        <div className="lg:col-span-4 relative">
          <div className="sticky top-28 flex flex-col border border-hairline rounded-lg overflow-hidden bg-white shadow-xs max-h-[calc(100vh-140px)]">
          <div className="px-3.5 py-2 bg-wash/60 border-b border-hairline flex items-center justify-between text-[11px] font-mono text-ink-light shrink-0">
            <span>Product Catalog</span>
            <span>{filteredProducts.length} total</span>
          </div>

          <div className="overflow-y-auto divide-y divide-hairline bg-white">
            {isLoadingList ? (
              <div className="py-8 text-center text-sm text-ink-light animate-pulse">Loading catalog…</div>
            ) : filteredProducts.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-light">No matching products. Upload and inspect packages first.</div>
            ) : filteredProducts.map((p) => {
              const isSelected = p.product_key === selectedProductKey;
              return (
                <button key={p.product_key} onClick={() => setSelectedProductKey(p.product_key)}
                  className={`w-full text-left px-4 py-2.5 transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-wash border-l-3 border-l-seal"
                      : "hover:bg-wash/50"
                  }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-heading font-semibold text-sm text-ink truncate">{p.common_name}</div>
                      <div className="text-xs text-ink-light truncate mt-0.5">{p.manufacturer_name}</div>
                    </div>
                    {p.has_active_regression && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-brick-light text-brick border border-brick/30 font-semibold flex-shrink-0">Regression</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] text-ink-light font-mono">
                    <span>{p.net_quantity || "Std pack"}</span>
                    <span>&bull;</span>
                    <span>{p.total_inspections} revisions</span>
                    <span>&bull;</span>
                    <span className={`font-semibold ${
                      p.latest_verdict === "PASS" ? "text-stamp-green" : p.latest_verdict === "FAIL" ? "text-brick" : "text-ochre"
                    }`}>
                      {p.latest_verdict}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          </div>
        </div>

        {/* RIGHT: History Details */}
        <div className="lg:col-span-8 space-y-6">
          {isLoadingHistory ? (
            <div className="border border-hairline rounded-lg p-12 text-center text-ink-light animate-pulse">
              Loading timeline &amp; regression analysis…
            </div>
          ) : !history ? (
            <div className="border border-hairline rounded-lg p-12 text-center text-ink-light">
              Select a product from the directory to inspect its statutory history.
            </div>
          ) : (
            <>
              {/* Product Overview */}
              <div className="border border-hairline rounded-lg p-5 bg-white">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="text-xl font-heading font-semibold text-ink">{history.product_name}</h2>
                      <TrendLabel trend={history.trend} />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-ink-light mt-1 flex-wrap">
                      <span>Brand:</span>
                      <button
                        onClick={() => onSelectManufacturer && onSelectManufacturer(history.manufacturer_key)}
                        className="text-seal font-medium hover:underline cursor-pointer"
                      >
                        {history.manufacturer_name} →
                      </button>
                      <span>·</span>
                      <span>Pack: {history.net_quantity || "Standard"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm font-mono flex-shrink-0">
                    <div className="text-center">
                      <div className="text-ink-light text-xs">Revisions</div>
                      <div className="text-lg font-semibold text-ink">{history.total_inspections}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-ink-light text-xs">Fail rate</div>
                      <div className={`text-lg font-semibold ${history.fail_rate > 0.3 ? "text-brick" : history.fail_rate > 0 ? "text-ochre" : "text-stamp-green"}`}>
                        {(history.fail_rate * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                </div>

                {history.has_active_regression && (
                  <div className="mt-4 border-l-3 border-l-brick bg-brick-light px-4 py-3">
                    <div className="text-sm font-medium text-brick">Active statutory regression detected</div>
                    <p className="text-xs text-ink mt-0.5">
                      The latest production batch failed one or more rules that previously passed. Immediate remediation recommended.
                    </p>
                  </div>
                )}
              </div>

              {/* Timeline */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-heading font-semibold text-ink">
                    Inspection chronology
                  </h3>
                  <span className="text-xs text-ink-light font-mono">Oldest to newest</span>
                </div>

                <div className="relative pl-6 space-y-4 before:content-[''] before:absolute before:left-2 before:top-3 before:bottom-3 before:w-px before:bg-hairline">
                  {history.entries.map((entry, idx) => {
                    const isLatest = idx === history.entries.length - 1;
                    const dateFormatted = new Date(entry.tested_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
                    return (
                      <div key={entry.package_id} className="relative">
                        {/* Timeline dot */}
                        <div className={`absolute -left-[22px] top-4 w-3 h-3 rounded-full border-2 bg-paper ${
                          entry.is_regression ? "border-brick"
                          : entry.overall_result === "PASS" ? "border-stamp-green"
                          : "border-ochre"
                        }`} />

                        <div className={`border border-hairline rounded-lg p-4 transition-colors ${
                          entry.is_regression ? "bg-brick-light" : "bg-white"
                        }`}>
                          {/* Entry Header */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-hairline mb-3">
                            <div className="flex items-center gap-2 flex-wrap text-xs">
                              <span className="font-medium text-ink">Revision #{idx + 1}</span>
                              <span className="text-ink-light font-mono">{dateFormatted}</span>
                              {isLatest && (
                                <span className="text-stamp-green font-medium">Current</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              {entry.is_regression && (
                                <span className="text-brick font-medium">Regression</span>
                              )}
                              <span className={`font-medium ${
                                entry.overall_result === "PASS" ? "text-stamp-green"
                                : entry.overall_result === "FAIL" ? "text-brick"
                                : "text-ochre"
                              }`}>
                                {entry.overall_result}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                            {entry.image_url && (
                              <div className="md:col-span-3">
                                <div
                                  onClick={() => setPreviewImage(`${API_BASE_URL}${entry.image_url}`)}
                                  className="group relative cursor-pointer rounded border border-hairline overflow-hidden bg-white aspect-[4/3] flex items-center justify-center"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={`${API_BASE_URL}${entry.image_url}`}
                                    alt={`Revision ${idx + 1}`}
                                    className="object-contain w-full h-full group-hover:scale-105 transition-transform duration-300"
                                    onError={(e) => { (e.target as HTMLElement).style.display = "none"; }}
                                  />
                                </div>
                              </div>
                            )}

                            <div className={entry.image_url ? "md:col-span-9" : "md:col-span-12"}>
                              {/* Key declarations */}
                              <div className="grid grid-cols-3 gap-2 bg-wash p-3 rounded border border-hairline mb-3 text-xs font-mono">
                                <div><span className="text-ink-light block">MRP</span><span className="font-medium text-ink">{entry.mrp || "N/A"}</span></div>
                                <div><span className="text-ink-light block">Net qty</span><span className="font-medium text-ink">{entry.net_quantity || "N/A"}</span></div>
                                <div><span className="text-ink-light block">Mfg date</span><span className="font-medium text-ink">{entry.mfg_date || "N/A"}</span></div>
                              </div>

                              {/* Regression Details */}
                              {entry.regression_details && entry.regression_details.length > 0 && (
                                <div className="border-l-3 border-l-brick bg-brick-light px-3 py-2 mb-3 text-xs">
                                  <div className="font-medium text-brick mb-1">Regressions in this revision:</div>
                                  {entry.regression_details.map((reg, i) => (
                                    <div key={i} className="text-ink pl-3">• {reg}</div>
                                  ))}
                                </div>
                              )}

                              {/* Failing Rules */}
                              {entry.failing_rules && entry.failing_rules.length > 0 ? (
                                <div className="space-y-2 mb-3">
                                  <div className="text-xs font-medium text-brick">
                                    Failing rules ({entry.failing_rules.length}):
                                  </div>
                                  {entry.failing_rules.map((rule, rIdx) => (
                                    <div key={rIdx} className="border-l-2 border-l-brick bg-white px-3 py-2 rounded-r text-xs border border-hairline">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="font-mono font-semibold text-brick">{rule.rule_id}</span>
                                        <span className="text-ink">{rule.description}</span>
                                      </div>
                                      <div className="text-ink-light">{rule.notes}</div>
                                      {rule.extracted_value && (
                                        <div className="text-ink-light mt-0.5">
                                          Declared: <span className="font-mono text-ink">&quot;{rule.extracted_value}&quot;</span>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-stamp-green mb-3">
                                  ✓ All mandatory declarations compliant in this batch
                                </div>
                              )}

                              {/* Changed Fields */}
                              {entry.changed_fields_since_last && entry.changed_fields_since_last.length > 0 && (
                                <div className="flex items-center gap-2 flex-wrap text-xs text-ink-light font-mono">
                                  <span>Changed:</span>
                                  {entry.changed_fields_since_last.map((fname) => (
                                    <span key={fname} className="px-1.5 py-0.5 rounded bg-wash border border-hairline text-ink text-[11px]">{fname}</span>
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

      {/* Image Lightbox */}
      {previewImage && (
        <div className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
          <div className="max-w-4xl max-h-[90vh] bg-white border border-hairline rounded-lg overflow-hidden p-2 relative" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewImage} alt="Packaging inspection label preview" className="max-h-[85vh] w-auto object-contain rounded mx-auto" />
            <button onClick={() => setPreviewImage(null)} className="absolute top-3 right-3 bg-white/80 hover:bg-wash text-ink rounded-full p-2 border border-hairline text-xs font-medium cursor-pointer">
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
