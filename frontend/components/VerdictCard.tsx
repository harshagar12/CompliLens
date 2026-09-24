"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Maximize2,
  ExternalLink,
  ShieldAlert,
  FileText,
  Layers,
} from "lucide-react";
import { Evaluation, API_BASE_URL } from "../lib/api";

interface VerdictCardProps {
  evaluation: Evaluation;
  rulesMap?: Record<string, { description: string; source_citation: string }>;
}

export const VerdictCard: React.FC<VerdictCardProps> = ({ evaluation, rulesMap = {} }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const ruleMeta = rulesMap[evaluation.rule_id];

  const cropFullUrl = evaluation.evidence_crop_url
    ? evaluation.evidence_crop_url.startsWith("http")
      ? evaluation.evidence_crop_url
      : `${API_BASE_URL}${evaluation.evidence_crop_url}`
    : null;

  const isPass = evaluation.result === "PASS";
  const isFail = evaluation.result === "FAIL";
  const isReview = evaluation.result === "NEEDS_REVIEW";

  return (
    <div
      className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
        isPass
          ? "border-emerald-500/30 bg-slate-900/60 shadow-md shadow-emerald-500/5 hover:border-emerald-500/40"
          : isFail
          ? "border-rose-500/40 bg-slate-900/80 shadow-md shadow-rose-500/10 hover:border-rose-500/60"
          : "border-amber-500/30 bg-slate-900/60 shadow-md shadow-amber-500/5"
      }`}
    >
      {/* Primary Card Face */}
      <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center space-x-3.5">
          {/* Status Icon */}
          <div
            className={`h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
              isPass
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                : isFail
                ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
            }`}
          >
            {isPass && <CheckCircle2 className="w-6 h-6" />}
            {isFail && <XCircle className="w-6 h-6" />}
            {isReview && <AlertTriangle className="w-6 h-6" />}
          </div>

          <div>
            <div className="flex items-center space-x-2.5">
              <span className="font-mono text-sm sm:text-base font-extrabold text-white tracking-wide">
                {evaluation.rule_id}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/80">
                v{evaluation.rule_version}
              </span>
              <span className="text-xs text-slate-400 font-sans hidden md:inline">
                • {evaluation.field_name.replace(/_/g, " ")}
              </span>
            </div>

            <p className="text-xs text-slate-400 font-mono mt-0.5">
              {ruleMeta?.source_citation || "Legal Metrology (Packaged Commodities) Rules, 2011"}
            </p>
          </div>
        </div>

        {/* Right side: Status Badge & Accordion Toggle */}
        <div className="flex items-center space-x-3 self-end sm:self-center">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-black tracking-wider uppercase border ${
              isPass
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                : isFail
                ? "bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse"
                : "bg-amber-500/20 text-amber-300 border-amber-500/40"
            }`}
          >
            {evaluation.result.replace("_", " ")}
          </span>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            type="button"
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors flex items-center gap-1 text-xs font-semibold"
          >
            <span className="hidden sm:inline">{isExpanded ? "Hide Details" : "View Evidence"}</span>
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Summary Line on Card Face */}
      <div className="px-5 sm:px-6 pb-4">
        {isFail ? (
          <div className="bg-rose-950/30 border border-rose-500/30 rounded-xl p-3 flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-rose-300 block">Statutory Non-Compliance Detected</span>
              <p className="text-xs text-rose-200/90 leading-relaxed font-sans">
                {evaluation.notes || "Required mandatory declaration is missing or does not meet LMPC 2011 standards."}
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 flex items-center justify-between text-xs text-slate-300 font-mono">
            <span className="text-slate-400">Verified Declaration:</span>
            <span className="font-semibold text-white truncate max-w-md">
              &ldquo;{evaluation.extracted_value || "Present & Verified"}&rdquo;
            </span>
          </div>
        )}
      </div>

      {/* Expandable Evidence Drawer (Progressive Disclosure) */}
      {isExpanded && (
        <div className="border-t border-slate-800/90 bg-slate-950/80 p-5 sm:p-6 space-y-4 transition-all animate-fadeIn">
          {/* Rule Description */}
          {ruleMeta?.description && (
            <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                Statutory Requirement Description
              </span>
              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                {ruleMeta.description}
              </p>
            </div>
          )}

          {/* Grid: Value vs Evidence Crop */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
            {/* Value & Finding */}
            <div className="md:col-span-8 space-y-3">
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                  Confirmed Value Evaluated
                </span>
                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 font-mono text-xs sm:text-sm text-slate-200">
                  {evaluation.extracted_value || (
                    <span className="text-rose-400 italic">Not found / Missing on package</span>
                  )}
                </div>
              </div>

              {evaluation.notes && (
                <div>
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                    Deterministic Engine Notes
                  </span>
                  <p className="text-xs text-slate-300 font-mono bg-slate-900/90 p-2.5 rounded-lg border border-slate-800 leading-relaxed">
                    {evaluation.notes}
                  </p>
                </div>
              )}
            </div>

            {/* Evidence Crop Thumbnail */}
            <div className="md:col-span-4 bg-slate-900 p-3 rounded-xl border border-slate-800 flex flex-col items-center justify-center text-center">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2 self-start">
                Package Evidence Crop
              </span>

              {cropFullUrl ? (
                <div className="relative group cursor-pointer" onClick={() => setShowModal(true)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cropFullUrl}
                    alt={`Evidence crop for ${evaluation.rule_id}`}
                    className="max-h-32 w-auto object-contain rounded border border-slate-700 bg-white"
                  />
                  <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center">
                    <Maximize2 className="w-5 h-5 text-white" />
                  </div>
                </div>
              ) : (
                <div className="h-28 w-full bg-slate-950 rounded border border-slate-800 flex flex-col items-center justify-center text-slate-500">
                  <FileText className="w-6 h-6 mb-1 text-slate-600" />
                  <span className="text-[11px]">No image crop</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {showModal && cropFullUrl && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 max-w-xl max-h-[85vh] overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cropFullUrl}
              alt="Evidence high-res crop"
              className="max-h-[70vh] w-auto mx-auto object-contain rounded-lg bg-white"
            />
            <div className="mt-3 text-center">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white rounded-lg"
              >
                Close Proof
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
