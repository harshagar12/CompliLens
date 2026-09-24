"use client";

import React, { useState, useEffect } from "react";
import { listRules, Rule } from "@/lib/api";

export const RulesCorpusView: React.FC = () => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<string>("all");

  useEffect(() => {
    listRules()
      .then(setRules)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = rules.filter((r) => {
    const matchesSearch =
      r.rule_id.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()) ||
      r.source_citation.toLowerCase().includes(search.toLowerCase());
    const matchesScope = scopeFilter === "all" || r.project_scope === scopeFilter;
    return matchesSearch && matchesScope;
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-semibold text-ink tracking-tight">
            Active statutory ruleset
          </h1>
          <p className="text-sm text-ink-light mt-0.5">
            Deterministic LMPC 2011 rules loaded in the compliance engine. Verdicts are never LLM-generated.
          </p>
        </div>
        <span className="font-mono text-xs text-ink-light">
          {filtered.length} of {rules.length} rules
        </span>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by rule ID, description, or citation…"
          className="flex-1 bg-paper border border-hairline rounded-md px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-seal font-body"
        />
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value)}
          className="bg-paper border border-hairline rounded-md px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-seal font-body cursor-pointer"
        >
          <option value="all">All scopes</option>
          <option value="mvp">MVP</option>
          <option value="final_year_target">Final year</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-16 text-ink-light text-sm">
          <span className="material-symbols-outlined text-[28px] animate-spin block mb-2">progress_activity</span>
          Loading rules…
        </div>
      ) : (
        <div className="border border-hairline rounded-lg overflow-hidden divide-y divide-hairline">
          {filtered.map((rule) => (
            <div
              key={rule.rule_id}
              className={`py-3.5 px-4 sm:px-5 hover:bg-wash/50 transition-colors border-l-3 ${
                rule.severity === "FAIL"
                  ? "border-l-brick"
                  : rule.severity === "WARN"
                  ? "border-l-ochre"
                  : "border-l-seal"
              }`}
            >
              <div className="flex items-start justify-between gap-4 mb-1.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-sm font-semibold text-ink">{rule.rule_id}</span>
                  <span className={`text-[11px] font-mono font-medium px-1.5 py-0.5 rounded ${
                    rule.severity === "FAIL"
                      ? "bg-brick-light text-brick"
                      : rule.severity === "WARN"
                      ? "bg-ochre-light text-ochre"
                      : "text-seal bg-wash"
                  }`}>
                    {rule.severity}
                  </span>
                  <span className="text-[11px] font-mono text-ink-light">
                    v{rule.version}
                  </span>
                  <span className="text-[11px] text-ink-light capitalize">
                    {rule.project_scope}
                  </span>
                </div>
                <span className={`text-[11px] font-mono flex-shrink-0 ${
                  rule.verification_status === "confirmed"
                    ? "text-stamp-green"
                    : "text-ochre"
                }`}>
                  {rule.verification_status.replace(/_/g, " ")}
                </span>
              </div>

              <p className="text-sm text-ink leading-relaxed mb-2">{rule.description}</p>

              <div className="flex flex-wrap gap-3 text-[11px] text-ink-light font-mono">
                <span>{rule.source_citation}</span>
                {rule.required_field && (
                  <span>
                    · Field: {rule.required_field.replace(/_/g, " ")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
