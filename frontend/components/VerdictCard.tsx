"use client";

import React, { useState } from "react";
import { Evaluation, API_BASE_URL } from "@/lib/api";

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

  return (
    <div
      className={`border-l-3 transition-colors ${
        isFail
          ? "border-l-brick bg-brick-light"
          : isPass
          ? "border-l-stamp-green"
          : "border-l-ochre bg-ochre-light"
      }`}
    >
      {/* Row */}
      <div className="py-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-hairline">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono text-sm font-semibold text-ink">
            {evaluation.rule_id}
          </span>
          <span className="text-[11px] font-mono text-ink-light">
            v{evaluation.rule_version}
          </span>
          <span className="text-xs text-ink-light hidden md:inline">
            · {evaluation.field_name.replace(/_/g, " ")}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`text-xs font-heading font-semibold ${
              isPass ? "text-stamp-green" : isFail ? "text-brick" : "text-ochre"
            }`}
          >
            {evaluation.result.replace("_", " ")}
          </span>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            type="button"
            className="text-xs text-ink-light hover:text-ink font-medium cursor-pointer"
          >
            {isExpanded ? "Hide" : "Evidence →"}
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="px-4 py-2 border-b border-hairline">
        {isFail ? (
          <p className="text-xs text-brick leading-relaxed">
            {evaluation.notes || "Required mandatory declaration is missing or does not meet LMPC 2011 standards."}
          </p>
        ) : (
          <p className="text-xs text-ink-light font-mono">
            Declared: &ldquo;{evaluation.extracted_value || "Present & verified"}&rdquo;
          </p>
        )}
      </div>

      {/* Evidence Drawer */}
      {isExpanded && (
        <div className="px-4 py-4 bg-wash/50 space-y-3">
          {ruleMeta?.description && (
            <div>
              <span className="text-[11px] font-medium text-ink-light block mb-1">
                Statutory requirement
              </span>
              <p className="text-xs text-ink leading-relaxed">{ruleMeta.description}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
            <div className="md:col-span-8 space-y-3">
              <div>
                <span className="text-[11px] font-medium text-ink-light block mb-1">
                  Confirmed value evaluated
                </span>
                <div className="bg-white p-2.5 rounded border border-hairline font-mono text-sm text-ink">
                  {evaluation.extracted_value || (
                    <span className="text-brick italic">Not found / missing on package</span>
                  )}
                </div>
              </div>
              {evaluation.notes && (
                <div>
                  <span className="text-[11px] font-medium text-ink-light block mb-1">
                    Engine notes
                  </span>
                  <p className="text-xs text-ink font-mono bg-white p-2.5 rounded border border-hairline leading-relaxed">
                    {evaluation.notes}
                  </p>
                </div>
              )}
            </div>

            <div className="md:col-span-4">
              <span className="text-[11px] font-medium text-ink-light block mb-1">
                Evidence crop
              </span>
              {cropFullUrl ? (
                <div
                  className="relative group cursor-pointer"
                  onClick={() => setShowModal(true)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cropFullUrl}
                    alt={`Evidence crop for ${evaluation.rule_id}`}
                    className="max-h-28 w-auto object-contain rounded border border-hairline bg-white"
                  />
                  <div className="absolute inset-0 bg-ink/30 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center">
                    <span className="text-white text-xs font-medium">Enlarge</span>
                  </div>
                </div>
              ) : (
                <div className="h-24 w-full bg-white rounded border border-hairline flex items-center justify-center text-ink-light text-xs">
                  No image crop
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {showModal && cropFullUrl && (
        <div
          className="fixed inset-0 bg-ink/60 z-50 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div className="bg-white border border-hairline rounded-lg p-4 max-w-xl max-h-[85vh] overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cropFullUrl}
              alt="Evidence high-res crop"
              className="max-h-[70vh] w-auto mx-auto object-contain rounded"
            />
            <div className="mt-3 text-center">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-1.5 bg-wash border border-hairline text-xs font-medium text-ink rounded-md cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
