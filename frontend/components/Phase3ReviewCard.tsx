"use client";

import React, { useState } from "react";
import { AlertCircle, Check, CheckCircle2, Edit3, Sparkles, FileText, Image as ImageIcon } from "lucide-react";
import { ExtractedField, API_BASE_URL } from "../lib/api";

interface Phase3ReviewCardProps {
  field: ExtractedField;
  onConfirm: (fieldName: string, confirmedValue: string, action: "accepted_raw" | "accepted_suggestion" | "manual_edit") => void;
  confidenceThreshold?: number;
}

const FIELD_LABELS: Record<string, { label: string; desc: string }> = {
  manufacturer_name_address: {
    label: "Manufacturer / Packer Address",
    desc: "Rule 6(1)(a) — Complete name, address, and facility location",
  },
  common_name: {
    label: "Common or Generic Commodity Name",
    desc: "Rule 6(1)(b) — Identity of product contained in package",
  },
  net_quantity: {
    label: "Net Quantity Declaration",
    desc: "Rule 6(1)(c) — Standard unit of weight/volume (g, ml, kg, L)",
  },
  mrp: {
    label: "Maximum Retail Price (MRP)",
    desc: "Rule 6(1)(e) — Inclusive of all taxes format",
  },
  mfg_month_year: {
    label: "Month & Year of Manufacture",
    desc: "Rule 6(1)(d) — Date of packaging/import",
  },
  consumer_care: {
    label: "Consumer Care Contact Details",
    desc: "Rule 6(2) — Name, address, phone/helpline, and email",
  },
};

export const Phase3ReviewCard: React.FC<Phase3ReviewCardProps> = ({
  field,
  onConfirm,
  confidenceThreshold = 0.75,
}) => {
  const meta = FIELD_LABELS[field.field_name] || { label: field.field_name, desc: "Mandatory declaration" };
  const isLowConfidence = field.confidence < confidenceThreshold;
  
  const [isEditing, setIsEditing] = useState(false);
  const [customValue, setCustomValue] = useState(field.confirmed_value || field.raw_value);

  const cropFullUrl = field.evidence_crop_url
    ? (field.evidence_crop_url.startsWith("http") ? field.evidence_crop_url : `${API_BASE_URL}${field.evidence_crop_url}`)
    : null;

  return (
    <div
      className={`rounded-xl p-5 border transition-all ${
        field.confirmed_value
          ? "border-emerald-500/40 bg-slate-900/60 shadow-md shadow-emerald-500/5"
          : isLowConfidence
          ? "border-amber-500/40 bg-amber-950/10 shadow-md shadow-amber-500/5"
          : "border-slate-800 bg-slate-900/40"
      }`}
    >
      {/* Header: Title, Field Key, and Confidence Badge */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center space-x-2">
            <h3 className="text-base font-semibold text-white">{meta.label}</h3>
            {field.confirmed_value && (
              <span className="inline-flex items-center space-x-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                <Check className="w-3 h-3" />
                <span>Confirmed</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{meta.desc}</p>
        </div>

        {/* Confidence Pill with alert if low */}
        <div className="flex items-center space-x-2">
          {isLowConfidence && (
            <div className="flex items-center space-x-1 text-xs text-amber-400 bg-amber-500/10 px-2 py-1 rounded-md border border-amber-500/30">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Flagged for Review</span>
            </div>
          )}
          <span
            className={`text-xs font-mono font-bold px-2 py-1 rounded-md ${
              isLowConfidence
                ? "bg-amber-500/20 text-amber-300"
                : "bg-emerald-500/20 text-emerald-300"
            }`}
          >
            {Math.round(field.confidence * 100)}% Conf
          </span>
        </div>
      </div>

      {/* Body: Cropped Evidence & Extracted Values */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Cropped Image Snippet */}
        <div className="md:col-span-4 bg-slate-950 rounded-lg p-2 border border-slate-800 flex flex-col items-center justify-center min-h-[100px]">
          {cropFullUrl ? (
            <div className="relative group w-full flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cropFullUrl}
                alt={meta.label}
                className="max-h-24 w-auto object-contain rounded border border-slate-800"
              />
              <span className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                <ImageIcon className="w-3 h-3" /> Cropped label evidence
              </span>
            </div>
          ) : (
            <div className="text-center p-3 text-slate-500 text-xs flex flex-col items-center">
              <FileText className="w-6 h-6 mb-1 opacity-50" />
              <span>Bounding box crop not generated</span>
            </div>
          )}
        </div>

        {/* Values: Raw OCR vs LLM Suggestion */}
        <div className="md:col-span-8 flex flex-col justify-between space-y-3">
          {/* Raw OCR Value */}
          <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800/80">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Raw OCR Text ({field.ocr_source})
              </span>
              <button
                onClick={() => onConfirm(field.field_name, field.raw_value, "accepted_raw")}
                className={`text-xs px-2.5 py-1 rounded transition-colors font-medium ${
                  field.confirmed_value === field.raw_value && field.reviewer_action === "accepted_raw"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                }`}
              >
                Accept Raw
              </button>
            </div>
            <p className="text-sm font-mono text-slate-200 break-words">{field.raw_value || "(empty)"}</p>
          </div>

          {/* Model Suggestion (Additive, never auto-applied) */}
          {field.suggested_value && (
            <div className="bg-purple-950/20 p-3 rounded-lg border border-purple-500/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-purple-300 uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-purple-400" />
                  Model Suggestion ({field.suggestion_source || "gemini-flash"})
                </span>
                <button
                  onClick={() => onConfirm(field.field_name, field.suggested_value!, "accepted_suggestion")}
                  className={`text-xs px-2.5 py-1 rounded transition-colors font-medium ${
                    field.confirmed_value === field.suggested_value && field.reviewer_action === "accepted_suggestion"
                      ? "bg-purple-600 text-white"
                      : "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-500/40"
                  }`}
                >
                  Accept Suggestion
                </button>
              </div>
              <p className="text-sm font-mono text-purple-200 break-words">{field.suggested_value}</p>
            </div>
          )}

          {/* Manual Edit Mode */}
          {isEditing ? (
            <div className="bg-slate-950 p-3 rounded-lg border border-cyan-500/40">
              <label className="text-[11px] font-semibold text-cyan-400 block mb-1">
                Manual Edit (Inspector Override)
              </label>
              <textarea
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm font-mono text-white focus:outline-none focus:border-cyan-500"
                rows={2}
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onConfirm(field.field_name, customValue, "manual_edit");
                    setIsEditing(false);
                  }}
                  className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-semibold"
                >
                  Save Confirmed Edit
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => setIsEditing(true)}
                className="text-xs text-slate-400 hover:text-cyan-400 flex items-center gap-1 transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Type Manual Edit</span>
              </button>

              {field.confirmed_value && (
                <div className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    Confirmed: &ldquo;{field.confirmed_value.length > 25 ? `${field.confirmed_value.slice(0, 25)}...` : field.confirmed_value}&rdquo;
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
