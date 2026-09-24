"use client";

import React, { useEffect, useState } from "react";
import {
  listManufacturers,
  getManufacturerSummary,
  ManufacturerListItem,
  ManufacturerSummary,
} from "@/lib/api";
import { ReportModal } from "./ReportModal";

interface ManufacturerAuditViewProps {
  initialManufacturerKey?: string | null;
  onSelectProduct?: (productKey: string) => void;
}

const RiskLabel: React.FC<{ risk: string }> = ({ risk }) => {
  const config: Record<string, { color: string }> = {
    HIGH: { color: "text-brick" },
    MEDIUM: { color: "text-ochre" },
    LOW: { color: "text-stamp-green" },
  };
  const c = config[risk] || config.LOW;
  return <span className={`text-xs font-medium ${c.color}`}>{risk.toLowerCase()} risk</span>;
};

const RemediationLabel: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<string, { color: string; label: string }> = {
    REMEDIATED: { color: "text-stamp-green", label: "Remediated" },
    EXEMPLARY: { color: "text-seal", label: "Exemplary" },
    REGRESSED: { color: "text-brick", label: "Regressed" },
    NON_COMPLIANT: { color: "text-ochre", label: "Action required" },
  };
  const s = map[status] || map.NON_COMPLIANT;
  return <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>;
};

export const ManufacturerAuditView: React.FC<ManufacturerAuditViewProps> = ({
  initialManufacturerKey,
  onSelectProduct,
}) => {
  const [manufacturers, setManufacturers] = useState<ManufacturerListItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialManufacturerKey || null);
  const [summary, setSummary] = useState<ManufacturerSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [violationScope, setViolationScope] = useState<"current" | "historical">("current");
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  useEffect(() => { loadManufacturers(); }, []);

  useEffect(() => {
    if (initialManufacturerKey) setSelectedKey(initialManufacturerKey);
  }, [initialManufacturerKey]);

  useEffect(() => {
    if (selectedKey) loadSummary(selectedKey);
  }, [selectedKey]);

  const loadManufacturers = async () => {
    setIsLoadingList(true);
    try {
      const data = await listManufacturers();
      setManufacturers(data);
      if (!selectedKey && data.length > 0) setSelectedKey(data[0].manufacturer_key);
    } catch (err) { console.error(err); }
    finally { setIsLoadingList(false); }
  };

  const loadSummary = async (mfgKey: string) => {
    setIsLoadingSummary(true);
    try {
      const data = await getManufacturerSummary(mfgKey);
      setSummary(data);
    } catch (err) { console.error(err); }
    finally { setIsLoadingSummary(false); }
  };

  const filteredMfgs = manufacturers.filter((m) =>
    m.manufacturer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.manufacturer_key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalMfgs = manufacturers.length;
  const highRiskCount = manufacturers.filter((m) => (m.current_risk_level || m.risk_level) === "HIGH").length;
  const totalRegressions = manufacturers.reduce((acc, m) => acc + m.active_regressions_count, 0);
  const avgCurrentCompliance = totalMfgs > 0
    ? (manufacturers.reduce((acc, m) => acc + (m.current_compliance_score ?? m.compliance_score), 0) / totalMfgs).toFixed(1)
    : "100.0";

  const violationsToDisplay = summary
    ? violationScope === "current"
      ? summary.current_statutory_violations || []
      : summary.historical_statutory_violations || summary.statutory_violations_breakdown || []
    : [];

  return (
    <div className="w-full space-y-6 pb-4 animate-fadeIn">
      {/* Header */}
        <div className="flex items-start justify-between pb-5 border-b border-hairline">
          <div>
            <h1 className="text-2xl font-heading font-semibold text-ink tracking-tight">
              Manufacturer compliance &amp; audit
            </h1>
            <p className="text-sm text-ink-light mt-0.5">
              Active shelf compliance vs lifetime track record, regressions watchlist, and statutory Pareto distributions.
            </p>
          </div>
        </div>

      {/* Fleet KPIs — single line */}
      <div className="flex flex-wrap items-center gap-4 text-sm font-mono text-ink-light py-2">
        <span><strong className="text-ink">{totalMfgs}</strong> manufacturers</span>
        <span>·</span>
        <span><strong className="text-ink">{avgCurrentCompliance}%</strong> avg compliance</span>
        <span>·</span>
        <span className={totalRegressions > 0 ? "text-brick" : ""}>
          <strong className={totalRegressions > 0 ? "text-brick" : "text-ink"}>{totalRegressions}</strong> regressions
        </span>
        <span>·</span>
        <span className={highRiskCount > 0 ? "text-brick" : ""}>
          <strong className={highRiskCount > 0 ? "text-brick" : "text-ink"}>{highRiskCount}</strong> high-risk
        </span>
      </div>

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-4">
        {/* LEFT: Manufacturer Directory */}
        <div className="lg:col-span-4 relative">
          <div className="sticky top-28 flex flex-col space-y-3 max-h-[calc(100vh-140px)]">
          <div className="shrink-0 space-y-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search manufacturer…"
              className="w-full bg-paper border border-hairline rounded-md px-3 py-2 text-sm text-ink font-body focus:outline-none focus:border-seal"
            />
            <div className="text-xs text-ink-light font-mono">
              {filteredMfgs.length} manufacturers
            </div>
          </div>

          <div className="overflow-y-auto border border-hairline rounded-lg divide-y divide-hairline bg-white">
            {isLoadingList ? (
              <div className="py-8 text-center text-sm text-ink-light animate-pulse">Loading manufacturers…</div>
            ) : filteredMfgs.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-light">No matching manufacturers. Inspect packages first.</div>
            ) : filteredMfgs.map((m) => {
              const isSelected = m.manufacturer_key === selectedKey;
              const currentScore = m.current_compliance_score ?? m.compliance_score;
              return (
                <button key={m.manufacturer_key} onClick={() => setSelectedKey(m.manufacturer_key)}
                  className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                    isSelected ? "bg-wash border-l-3 border-l-seal" : "hover:bg-wash/50"
                  }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-heading font-semibold text-sm text-ink truncate">{m.manufacturer_name}</div>
                      <div className="text-xs text-ink-light mt-0.5">{m.product_count} products · {m.total_inspections} revisions</div>
                    </div>
                    <RiskLabel risk={m.current_risk_level || m.risk_level} />
                  </div>

                  {/* Compliance bar */}
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-ink-light font-mono">Active shelf</span>
                      <span className="font-medium text-ink font-mono">{currentScore.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-wash h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${currentScore >= 80 ? "bg-stamp-green" : currentScore >= 60 ? "bg-ochre" : "bg-brick"}`}
                        style={{ width: `${Math.min(100, currentScore)}%` }}
                      />
                    </div>
                  </div>

                  {m.active_regressions_count > 0 && (
                    <div className="mt-1.5 text-[10px] text-brick font-medium">
                      {m.active_regressions_count} product(s) in active regression
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          </div>
        </div>

        {/* RIGHT: Deep Dive */}
        <div className="lg:col-span-8 space-y-6">
          {isLoadingSummary ? (
            <div className="border border-hairline rounded-lg p-12 text-center text-ink-light animate-pulse">
              Aggregating manufacturer audit data…
            </div>
          ) : !summary ? (
            <div className="border border-hairline rounded-lg p-12 text-center text-ink-light">
              Select a manufacturer to inspect compliance portfolio.
            </div>
          ) : (
            <>
              {/* Manufacturer Header */}
              <div className="border border-hairline rounded-lg p-5 bg-white space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="text-xl font-heading font-semibold text-ink">{summary.manufacturer_name}</h2>
                      <RiskLabel risk={summary.current_risk_level} />
                    </div>
                    {summary.raw_name_address && (
                      <p className="text-xs text-ink-light mt-1">{summary.raw_name_address}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0 font-mono text-sm">
                    <div className="text-center">
                      <div className="text-xs text-ink-light">Active shelf</div>
                      <div className="text-xl font-semibold text-stamp-green">{summary.current_compliance_score.toFixed(1)}%</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-ink-light">Lifetime</div>
                      <div className="text-xl font-semibold text-ink">{summary.historical_compliance_score.toFixed(1)}%</div>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-hairline flex items-center justify-between flex-wrap gap-2 text-xs text-ink-light">
                  <div className="flex items-center gap-2">
                    <span>Portfolio status:</span>
                    <RemediationLabel status={summary.remediation_status} />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono">
                      <strong className="text-ink">{summary.product_count}</strong> products ·{" "}
                      <strong className="text-ink">{summary.total_inspections}</strong> inspections
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsReportModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-seal hover:bg-seal-light text-white text-xs font-heading font-semibold transition-colors shadow-2xs cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">description</span>
                      <span>Generate Manufacturer Report</span>
                    </button>
                  </div>
                </div>

                {summary.products_with_active_regression.length > 0 && (
                  <div className="border-l-3 border-l-brick bg-brick-light px-4 py-3">
                    <div className="text-sm font-medium text-brick">
                      Active regressions ({summary.products_with_active_regression.length})
                    </div>
                    <p className="text-xs text-ink mt-0.5">
                      Products under this brand previously met legal requirements but failed in newer revisions.
                    </p>
                  </div>
                )}
              </div>

              {/* Violation Pareto */}
              <div className="border border-hairline rounded-lg p-5 bg-white space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-heading font-semibold text-ink">
                      Statutory violations breakdown
                    </h3>
                    <p className="text-xs text-ink-light mt-0.5">
                      Distribution of rule failures across product packaging.
                    </p>
                  </div>
                  <div className="flex items-center border border-hairline rounded-md overflow-hidden text-xs self-start sm:self-auto">
                    {[
                      { key: "current" as const, label: "Active" },
                      { key: "historical" as const, label: "All-time" },
                    ].map(({ key, label }) => (
                      <button key={key} onClick={() => setViolationScope(key)}
                        className={`px-3 py-1.5 font-medium transition-colors cursor-pointer ${
                          violationScope === key
                            ? "bg-seal text-white"
                            : "bg-paper text-ink-light hover:text-ink"
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {violationsToDisplay.length === 0 ? (
                  <div className="py-6 text-center text-sm text-stamp-green">
                    ✓ {violationScope === "current" ? "Zero active violations on shelves" : "Zero statutory violations recorded"}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {violationsToDisplay.map((item) => (
                      <div key={item.rule_id} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-semibold text-brick">{item.rule_id}</span>
                            <span className="text-ink">{item.description}</span>
                          </div>
                          <span className="font-medium text-ink flex-shrink-0 font-mono">
                            {item.fail_count} ({item.percentage}%)
                          </span>
                        </div>
                        <div className="w-full bg-wash h-2 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-brick rounded-full"
                            style={{ width: `${Math.min(100, item.percentage)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Product Portfolio Table */}
              <div className="border border-hairline rounded-lg p-5 bg-white space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-heading font-semibold text-ink">
                      Product portfolio &amp; shelf status
                    </h3>
                    <p className="text-xs text-ink-light mt-0.5">Current packaging status per product.</p>
                  </div>
                  <span className="text-xs text-ink-light font-mono">{summary.products.length} commodities</span>
                </div>

                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="min-w-[760px] w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-hairline text-ink-light font-mono">
                        <th className="pb-2.5 font-medium min-w-[200px]">Commodity</th>
                        <th className="pb-2.5 font-medium w-24">Pack</th>
                        <th className="pb-2.5 font-medium w-28">Status</th>
                        <th className="pb-2.5 font-medium min-w-[260px]">Non-compliances</th>
                        <th className="pb-2.5 font-medium w-28">Trend</th>
                        <th className="pb-2.5 font-medium w-24 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {summary.products.map((p) => {
                        const hasFails = p.latest_failing_rules && p.latest_failing_rules.length > 0;
                        return (
                          <tr key={p.product_key} className="hover:bg-wash/50 transition-colors">
                            <td className="py-3 pr-4">
                              <div className="font-heading font-semibold text-sm text-ink">{p.common_name}</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[11px] text-ink-light font-mono">{p.total_inspections} batches</span>
                                {p.has_active_regression && (
                                  <span className="inline-flex items-center px-1.5 py-0.2 text-[10px] font-semibold bg-brick/10 text-brick rounded border border-brick/20">
                                    Regression
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 pr-4 text-ink font-mono font-medium">{p.net_quantity || "Std"}</td>
                            <td className="py-3 pr-4">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide uppercase border ${
                                p.latest_verdict === "PASS" ? "bg-stamp-green/10 text-stamp-green border-stamp-green/20"
                                : p.latest_verdict === "FAIL" ? "bg-brick/10 text-brick border-brick/20"
                                : "bg-ochre/10 text-ochre border-ochre/20"
                              }`}>
                                {p.latest_verdict}
                              </span>
                            </td>
                            <td className="py-3 pr-4 max-w-xs">
                              {hasFails ? (
                                <div className="space-y-1">
                                  {p.latest_failing_rules.map((rf, rIdx) => (
                                    <div key={rIdx} className="flex items-center gap-1.5 min-w-0">
                                      <span className="shrink-0 font-mono font-semibold text-brick text-[10px] px-1 py-0.5 rounded bg-brick/10 border border-brick/20">
                                        {rf.rule_id}
                                      </span>
                                      <span className="text-ink-light truncate text-[11px] min-w-0 flex-1" title={rf.notes}>
                                        {rf.notes}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-stamp-green text-[11px] font-medium">
                                  <span>✓</span> Compliant
                                </span>
                              )}
                            </td>
                            <td className="py-3 pr-4">
                              <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded ${
                                p.trend === "IMPROVING" ? "bg-stamp-green/10 text-stamp-green"
                                : p.trend === "DEGRADING" ? "bg-brick/10 text-brick"
                                : "bg-wash text-ink-light"
                              }`}>
                                <span>{p.trend === "IMPROVING" ? "↑" : p.trend === "DEGRADING" ? "↓" : "—"}</span>
                                <span className="capitalize">{p.trend.toLowerCase()}</span>
                              </span>
                            </td>
                            <td className="py-3 text-right">
                              <button
                                onClick={() => onSelectProduct && onSelectProduct(p.product_key)}
                                className="inline-flex items-center gap-1 text-xs text-seal font-medium hover:underline cursor-pointer"
                              >
                                <span>Timeline</span>
                                <span>→</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {/* Manufacturer Fleet Compliance Audit Report Modal */}
      {summary && (
        <ReportModal
          isOpen={isReportModalOpen}
          onClose={() => setIsReportModalOpen(false)}
          type="manufacturer"
          data={summary}
        />
      )}
    </div>
  );
};
export default ManufacturerAuditView;
