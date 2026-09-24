"use client";

import React, { useEffect, useState } from "react";
import {
  listManufacturers,
  getManufacturerSummary,
  ManufacturerListItem,
  ManufacturerSummary,
} from "../lib/api";
import {
  Building2,
  Search,
  AlertOctagon,
  ShieldCheck,
  ShieldAlert,
  BarChart3,
  TrendingUp,
  Layers,
  ArrowRight,
  MapPin,
  Package,
  AlertTriangle,
  FileText,
  CheckCircle2,
  Clock,
  History,
  Sparkles,
  Info,
} from "lucide-react";

interface ManufacturerDashboardViewProps {
  initialManufacturerKey?: string | null;
  onSelectProduct?: (productKey: string) => void;
}

export const ManufacturerDashboardView: React.FC<ManufacturerDashboardViewProps> = ({
  initialManufacturerKey,
  onSelectProduct,
}) => {
  const [manufacturers, setManufacturers] = useState<ManufacturerListItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialManufacturerKey || null);
  const [summary, setSummary] = useState<ManufacturerSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [violationScope, setViolationScope] = useState<"current" | "historical">("current");

  useEffect(() => {
    loadManufacturers();
  }, []);

  useEffect(() => {
    if (initialManufacturerKey) {
      setSelectedKey(initialManufacturerKey);
    }
  }, [initialManufacturerKey]);

  useEffect(() => {
    if (selectedKey) {
      loadSummary(selectedKey);
    }
  }, [selectedKey]);

  const loadManufacturers = async () => {
    setIsLoadingList(true);
    try {
      const data = await listManufacturers();
      setManufacturers(data);
      if (!selectedKey && data.length > 0) {
        setSelectedKey(data[0].manufacturer_key);
      }
    } catch (err) {
      console.error("Failed to load manufacturers:", err);
    } finally {
      setIsLoadingList(false);
    }
  };

  const loadSummary = async (mfgKey: string) => {
    setIsLoadingSummary(true);
    try {
      const data = await getManufacturerSummary(mfgKey);
      setSummary(data);
    } catch (err) {
      console.error("Failed to load manufacturer summary:", err);
    } finally {
      setIsLoadingSummary(false);
    }
  };

  const filteredMfgs = manufacturers.filter(
    (m) =>
      m.manufacturer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.manufacturer_key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Fleet Statistics
  const totalMfgs = manufacturers.length;
  const highRiskCount = manufacturers.filter((m) => m.current_risk_level === "HIGH").length;
  const totalRegressions = manufacturers.reduce((acc, m) => acc + m.active_regressions_count, 0);
  const avgCurrentCompliance =
    totalMfgs > 0
      ? (
          manufacturers.reduce((acc, m) => acc + (m.current_compliance_score ?? m.compliance_score), 0) /
          totalMfgs
        ).toFixed(1)
      : "100.0";

  const getRiskBadge = (risk: "LOW" | "MEDIUM" | "HIGH", labelPrefix: string = "") => {
    switch (risk) {
      case "HIGH":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
            <AlertOctagon className="w-3.5 h-3.5 text-rose-400" /> {labelPrefix} HIGH RISK
          </span>
        );
      case "MEDIUM":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> {labelPrefix} MEDIUM RISK
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> {labelPrefix} LOW RISK
          </span>
        );
    }
  };

  const getRemediationBadge = (status: ManufacturerSummary["remediation_status"]) => {
    switch (status) {
      case "REMEDIATED":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Remediated (Past non-compliances fixed in latest revisions)
          </span>
        );
      case "EXEMPLARY":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            Exemplary 100% Compliance History
          </span>
        );
      case "REGRESSED":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            Regressed (Latest packaging failed previously passing rules)
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            Action Required on Active Packaging
          </span>
        );
    }
  };

  // Active or Historical breakdown depending on user toggle
  const violationsToDisplay = summary
    ? violationScope === "current"
      ? summary.current_statutory_violations || []
      : summary.historical_statutory_violations || summary.statutory_violations_breakdown || []
    : [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Manufacturer Compliance Fleet & Audit
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                PRD §8.5
              </span>
            </h1>
            <p className="text-sm text-slate-400">
              Surfaces active shelf compliance vs lifetime track record, active regressions watchlist, and statutory Pareto distributions.
            </p>
          </div>
        </div>
      </div>

      {/* Fleet Top KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 backdrop-blur-sm">
          <div className="text-xs font-medium text-slate-400">Manufacturers Tracked</div>
          <div className="text-2xl font-bold text-white mt-1">{totalMfgs}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Across FMCG & Packaged Foods</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 backdrop-blur-sm">
          <div className="text-xs font-medium text-slate-400">Active Shelf Compliance</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">{avgCurrentCompliance}%</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Benchmark on latest revisions</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 backdrop-blur-sm">
          <div className="text-xs font-medium text-slate-400">Active Regressions Watchlist</div>
          <div
            className={`text-2xl font-bold mt-1 ${
              totalRegressions > 0 ? "text-rose-400 animate-pulse" : "text-slate-200"
            }`}
          >
            {totalRegressions}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Products broken in newer batches</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 backdrop-blur-sm">
          <div className="text-xs font-medium text-slate-400">High Risk Portfolios</div>
          <div
            className={`text-2xl font-bold mt-1 ${
              highRiskCount > 0 ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {highRiskCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Active failure rate &gt; 35%</div>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Manufacturer List Directory */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 backdrop-blur-sm">
            <div className="relative mb-3">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search manufacturer..."
                className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
              />
            </div>

            <div className="text-xs text-slate-400 px-1 mb-2 font-medium">
              Manufacturers ({filteredMfgs.length})
            </div>

            <div className="space-y-2 max-h-[calc(100vh-380px)] overflow-y-auto pr-1">
              {isLoadingList ? (
                <div className="py-8 text-center text-sm text-slate-500 animate-pulse">
                  Loading manufacturers...
                </div>
              ) : filteredMfgs.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  No matching manufacturers found.
                </div>
              ) : (
                filteredMfgs.map((m) => {
                  const isSelected = m.manufacturer_key === selectedKey;
                  const currentScore = m.current_compliance_score ?? m.compliance_score;
                  const histScore = m.historical_compliance_score ?? currentScore;

                  return (
                    <button
                      key={m.manufacturer_key}
                      onClick={() => setSelectedKey(m.manufacturer_key)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                        isSelected
                          ? "bg-purple-500/10 border-purple-500/40 shadow-lg shadow-purple-500/5"
                          : "bg-slate-950/40 border-slate-800/60 hover:bg-slate-800/40 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm text-slate-100 truncate">
                            {m.manufacturer_name}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {m.product_count} products • {m.total_inspections} revisions tested
                          </div>
                        </div>
                        {getRiskBadge(m.current_risk_level || m.risk_level)}
                      </div>

                      {/* Active Compliance Progress Bar */}
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-slate-400">Active Shelf Compliance</span>
                          <span className="font-bold text-slate-200">{currentScore.toFixed(1)}%</span>
                        </div>
                        <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              currentScore >= 80
                                ? "bg-emerald-500"
                                : currentScore >= 60
                                ? "bg-amber-500"
                                : "bg-rose-500"
                            }`}
                            style={{ width: `${Math.min(100, currentScore)}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500">
                        <span>Lifetime Track Record: {histScore.toFixed(1)}%</span>
                        {m.remediation_status === "REMEDIATED" && (
                          <span className="text-emerald-400 font-semibold">Remediated</span>
                        )}
                      </div>

                      {m.active_regressions_count > 0 && (
                        <div className="mt-2 text-[10px] font-semibold text-rose-300 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-400" />
                          {m.active_regressions_count} product(s) in active regression
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Deep Dive Summary Panel */}
        <div className="lg:col-span-8 space-y-6">
          {isLoadingSummary ? (
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-12 text-center text-slate-400 animate-pulse">
              Aggregating manufacturer audit data...
            </div>
          ) : !summary ? (
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-12 text-center text-slate-400">
              Select a manufacturer to inspect compliance portfolio.
            </div>
          ) : (
            <>
              {/* Manufacturer Header Card with Dual Compliance Metrics */}
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="text-xl font-bold text-white tracking-tight">
                        {summary.manufacturer_name}
                      </h2>
                      {getRiskBadge(summary.current_risk_level, "CURRENT")}
                    </div>
                    {summary.raw_name_address && (
                      <div className="flex items-start gap-1.5 text-xs text-slate-400 mt-2">
                        <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                        <span>{summary.raw_name_address}</span>
                      </div>
                    )}
                  </div>

                  {/* Dual Scores KPI Badges */}
                  <div className="flex items-center gap-3 shrink-0 flex-wrap">
                    {/* Score 1: Active Packaging on Shelves */}
                    <div className="px-4 py-2.5 rounded-xl bg-slate-950/70 border border-emerald-500/30 text-center">
                      <div className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">
                        Active Shelf Score
                      </div>
                      <div className="text-2xl font-extrabold text-emerald-300 mt-0.5">
                        {summary.current_compliance_score.toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-slate-400">Latest revisions</div>
                    </div>

                    {/* Score 2: Lifetime Historical Record */}
                    <div className="px-4 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-center">
                      <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                        Lifetime Score
                      </div>
                      <div className="text-2xl font-extrabold text-slate-200 mt-0.5">
                        {summary.historical_compliance_score.toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-slate-500">All-time record</div>
                    </div>
                  </div>
                </div>

                {/* Remediation Status Callout */}
                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Portfolio Status:</span>
                    {getRemediationBadge(summary.remediation_status)}
                  </div>

                  <div className="text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">{summary.product_count}</span> products •{" "}
                    <span className="font-semibold text-slate-200">{summary.total_inspections}</span> total batch inspections
                  </div>
                </div>

                {/* Active Regressions Watchlist Banner */}
                {summary.products_with_active_regression.length > 0 && (
                  <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5 animate-bounce" />
                    <div>
                      <div className="text-sm font-bold text-rose-300 uppercase tracking-wide">
                        Active Statutory Regressions In Fleet ({summary.products_with_active_regression.length})
                      </div>
                      <p className="text-xs text-rose-200/90 mt-1">
                        One or more products under this brand previously met legal requirements but failed in newer revisions. Immediate regulatory follow-up required.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Statutory Violation Pareto Analysis with Current vs Historical Toggle */}
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-white flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-purple-400" />
                      Statutory Violations Breakdown (Pareto Frequency)
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Distribution of Legal Metrology rule failures across product packaging.
                    </p>
                  </div>

                  {/* Scope Selector: Current vs All-time History */}
                  <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 self-start sm:self-auto">
                    <button
                      onClick={() => setViolationScope("current")}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                        violationScope === "current"
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/30 shadow-sm"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Active Packaging (On Shelves)
                    </button>
                    <button
                      onClick={() => setViolationScope("historical")}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                        violationScope === "historical"
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/30 shadow-sm"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      All-Time History
                    </button>
                  </div>
                </div>

                {/* Content based on selected scope */}
                {violationsToDisplay.length === 0 ? (
                  <div className="py-8 px-4 text-center rounded-xl bg-emerald-950/20 border border-emerald-500/30 space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                    <div className="text-sm font-bold text-emerald-300">
                      {violationScope === "current"
                        ? "Zero Active Violations On Shelves!"
                        : "Zero Statutory Violations Recorded!"}
                    </div>
                    <p className="text-xs text-emerald-200/80 max-w-md mx-auto">
                      {violationScope === "current"
                        ? "All products in this manufacturer's active portfolio currently meet 100% of Legal Metrology requirements. Any previous revision non-compliances have been successfully remediated."
                        : "This manufacturer has maintained a flawless compliance record across all inspected revisions."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3.5 pt-1">
                    {violationsToDisplay.map((item) => (
                      <div key={item.rule_id} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-rose-300 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                              {item.rule_id}
                            </span>
                            <span className="text-slate-300 font-medium">{item.description}</span>
                            <span className="text-[10px] text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded border border-purple-500/25">
                              {item.citation}
                            </span>
                          </div>
                          <span className="font-semibold text-slate-300 shrink-0">
                            {item.fail_count} non-compliances ({item.percentage}%)
                          </span>
                        </div>
                        <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                          <div
                            className="h-full bg-gradient-to-r from-purple-500 to-rose-500 rounded-full"
                            style={{ width: `${Math.min(100, item.percentage)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Product Portfolio Table with Direct Rule Failure Visibility */}
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-white flex items-center gap-2">
                      <Package className="w-4 h-4 text-cyan-400" />
                      Brand Product Portfolio & Active Shelf Status
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Direct view of current packaging status and active non-compliances per product.
                    </p>
                  </div>
                  <span className="text-xs text-slate-400">
                    {summary.products.length} registered commodities
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="pb-3 font-semibold">Commodity</th>
                        <th className="pb-3 font-semibold">Pack Size</th>
                        <th className="pb-3 font-semibold">Current Status</th>
                        <th className="pb-3 font-semibold">Active Non-Compliances</th>
                        <th className="pb-3 font-semibold">Trajectory</th>
                        <th className="pb-3 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {summary.products.map((p) => {
                        const hasFails =
                          p.latest_failing_rules && p.latest_failing_rules.length > 0;

                        return (
                          <tr key={p.product_key} className="hover:bg-slate-800/30 transition-colors">
                            <td className="py-3.5 font-medium text-slate-200">
                              <div className="font-semibold text-sm">{p.common_name}</div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {p.total_inspections} batches tested
                              </div>
                              {p.has_active_regression && (
                                <span className="inline-block mt-1 text-[10px] font-bold text-rose-400 bg-rose-500/15 px-1.5 py-0.5 rounded border border-rose-500/30 animate-pulse">
                                  ACTIVE REGRESSION
                                </span>
                              )}
                            </td>

                            <td className="py-3.5 text-slate-300 font-mono">
                              {p.net_quantity || "Std"}
                            </td>

                            <td className="py-3.5">
                              <span
                                className={`px-2.5 py-1 rounded-md font-bold text-[11px] border ${
                                  p.latest_verdict === "PASS"
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : p.latest_verdict === "FAIL"
                                    ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                    : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                }`}
                              >
                                {p.latest_verdict}
                              </span>
                            </td>

                            {/* Active Non-Compliances Column */}
                            <td className="py-3.5 max-w-xs">
                              {hasFails ? (
                                <div className="space-y-1">
                                  {p.latest_failing_rules.map((rf, rIdx) => (
                                    <div key={rIdx} className="flex items-center gap-1.5">
                                      <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-mono text-[10px] font-bold">
                                        {rf.rule_id}
                                      </span>
                                      <span className="text-slate-300 truncate text-[11px]" title={rf.notes}>
                                        {rf.notes}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Fully Compliant
                                </span>
                              )}
                            </td>

                            <td className="py-3.5">
                              <span
                                className={`font-semibold text-[11px] ${
                                  p.trend === "IMPROVING"
                                    ? "text-emerald-400"
                                    : p.trend === "DEGRADING"
                                    ? "text-rose-400"
                                    : "text-slate-400"
                                }`}
                              >
                                {p.trend}
                              </span>
                            </td>

                            <td className="py-3.5 text-right">
                              <button
                                onClick={() => onSelectProduct && onSelectProduct(p.product_key)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 font-semibold text-xs border border-slate-700 transition-all"
                              >
                                <span>Inspect Timeline</span>
                                <ArrowRight className="w-3.5 h-3.5" />
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
    </div>
  );
};
