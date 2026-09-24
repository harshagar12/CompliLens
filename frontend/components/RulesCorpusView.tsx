"use client";

import React, { useState, useEffect } from "react";
import { BookOpen, Shield, CheckCircle2, AlertCircle } from "lucide-react";
import { listRules, Rule } from "../lib/api";

export const RulesCorpusView: React.FC = () => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listRules()
      .then((data) => setRules(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-cyan-400" />
          Statutory Rules Corpus & Transparency Registry
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Every compliance verdict traces deterministically to versioned clauses from the Legal Metrology (Packaged Commodities) Rules, 2011.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">Loading statutory rules...</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            {rules.map((rule) => {
              const isNeedsLegalReview = rule.verification_status === "needs_legal_review";

              return (
                <div
                  key={rule.rule_id}
                  className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-800/80">
                    <div className="flex items-center space-x-3">
                      <span className="font-mono text-sm font-bold text-cyan-400">{rule.rule_id}</span>
                      <span className="text-xs font-mono text-slate-500">v{rule.version}</span>
                      <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold">
                        Field: {rule.required_field}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-400 uppercase">
                        Scope: {rule.project_scope}
                      </span>
                      {isNeedsLegalReview ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          <AlertCircle className="w-3 h-3" /> Needs Legal Review
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3" /> Confirmed
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 mb-2 leading-relaxed">{rule.description}</p>
                  
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80 flex items-center justify-between text-xs font-mono text-slate-400">
                    <span>Citation: {rule.source_citation}</span>
                    <span className="text-slate-500">Severity: {rule.severity}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
