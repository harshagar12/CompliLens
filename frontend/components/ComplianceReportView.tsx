"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { PackageVerdict } from "@/lib/api";
import { ReportModal } from "./ReportModal";
import { VerdictCard } from "./VerdictCard";

interface ComplianceReportViewProps {
  verdict: PackageVerdict;
  fields?: any[];
  onReset: () => void;
  imageUrl?: string | null;
}

export const ComplianceReportView: React.FC<ComplianceReportViewProps> = ({
  verdict,
  fields = [],
  onReset,
  imageUrl,
}) => {
  const [showReport, setShowReport] = useState(false);

  // Mock Rules Mapping for Context
  const rulesMap: Record<string, { description: string; source_citation: string }> = {
    "LMPC-001": { description: "Name and address of manufacturer or packer.", source_citation: "Rule 6(1)(a)" },
    "LMPC-002": { description: "Common or generic name of commodity.", source_citation: "Rule 6(1)(b)" },
    "LMPC-003": { description: "Net quantity in standard units.", source_citation: "Rule 6(1)(c)" },
    "LMPC-004": { description: "Month and year of manufacture or packaging.", source_citation: "Rule 6(1)(d)" },
    "LMPC-005": { description: "Retail sale price (MRP) inclusive of all taxes.", source_citation: "Rule 6(1)(e)" },
    "LMPC-006": { description: "Consumer care details (phone, email, address).", source_citation: "Rule 6(1)(g)" },
  };

  const isPass = verdict.overall_result === "PASS";
  const isFail = verdict.overall_result === "FAIL";

  return (
    <div className="space-y-8 animate-fadeIn w-full mt-4">
      {/* 1. Header & Stamp (Redesigned Top Div) */}
      <div className="w-full bg-paper border border-hairline p-6 sm:p-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-10 shadow-sm rounded-lg">
        {/* Left: Overall Verdict Info */}
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl sm:text-3xl font-heading font-semibold text-ink tracking-tight flex items-center gap-3">
              Inspection Dossier
            </h1>
            <p className="text-sm font-mono text-ink-light">
              Compliance report for <span className="font-semibold text-ink">Package Ref: {verdict.package_id}</span>
            </p>
          </div>

          <div className="flex items-center flex-wrap gap-4 text-xs font-mono">
            <div className="flex items-center gap-1.5 text-ink-light">
              <span className="material-symbols-outlined text-[16px]">category</span>
              <span className="capitalize">{verdict.category.replace(/_/g, " ")}</span>
            </div>
            <span className="text-hairline">|</span>
            <div className="flex items-center gap-1.5 text-ink-light">
              <span className="material-symbols-outlined text-[16px]">gavel</span>
              LMPC Rules, 2011
            </div>
            {verdict.exemption_applied && (
              <>
                <span className="text-hairline">|</span>
                <span className="px-2 py-0.5 border border-primary/30 bg-primary/10 text-primary font-semibold rounded uppercase">
                  Exempt: {verdict.exemption_applied}
                </span>
              </>
            )}
          </div>
          
          <div className="pt-2 flex flex-wrap items-center gap-3">
             <button onClick={() => setShowReport(true)} className="px-4 py-2 bg-seal text-white font-mono text-xs hover:bg-seal/90 transition-colors flex items-center gap-2 cursor-pointer shadow-sm rounded-md">
               <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
               Generate Report
             </button>
             <button onClick={onReset} className="px-4 py-2 border border-hairline bg-white text-ink font-mono text-xs hover:bg-wash transition-colors cursor-pointer flex items-center gap-2 shadow-sm rounded-md">
               <span className="material-symbols-outlined text-[16px]">refresh</span>
               New Inspection
             </button>
          </div>
        </div>

        {/* Right: The Stamp Animation */}
        <div className="relative flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 1.5, opacity: 0, rotate: 0 }}
            animate={{ scale: 1, opacity: 1, rotate: -6 }}
            transition={{ type: "spring", stiffness: 200, damping: 12, delay: 0.1 }}
            className={`px-8 py-3 border-4 font-heading font-bold text-3xl uppercase tracking-widest shadow-sm bg-paper ${
              isPass
                ? "border-stamp-green text-stamp-green"
                : isFail
                ? "border-brick text-brick"
                : "border-ochre text-ochre"
            }`}
          >
            {verdict.overall_result}
          </motion.div>
        </div>
      </div>

      {/* 2. Statutory Rules Checklist & Evidence Proofs (Restored to use VerdictCard) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-headline font-bold text-ink flex items-center gap-2">
            <span className="material-symbols-outlined text-seal text-[20px]">rule</span>
            <span>Statutory Rules Checklist & Evidence Proofs</span>
          </h3>
          <span className="text-xs text-ink-light font-mono hidden sm:inline">
            Statutory rule verification under LMPC 2011
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {verdict.evaluations.map((ev) => (
            <VerdictCard key={ev.rule_id} evaluation={ev} rulesMap={rulesMap} />
          ))}
        </div>
      </div>

      <ReportModal 
        isOpen={showReport} 
        onClose={() => setShowReport(false)}
        type="inspection"
        data={{ verdict, fields, imageUrl }}
      />
    </div>
  );
};
