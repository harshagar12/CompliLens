"use client";

import React, { useState, useRef } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Edit3,
  Check,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  ShieldCheck,
  Eye,
  ArrowRight,
  HelpCircle,
  FileCheck,
  Layers,
} from "lucide-react";
import { ExtractedField, API_BASE_URL } from "../lib/api";

interface ExtractionReviewStudioProps {
  fields: ExtractedField[];
  previewUrl: string | null;
  onConfirmField: (
    fieldName: string,
    confirmedValue: string,
    action: "accepted_raw" | "accepted_suggestion" | "manual_edit"
  ) => void;
  onConfirmAllHighConfidence: () => void;
  onSubmitEvaluation: () => void;
  onDiscard: () => void;
  loading: boolean;
  loadingStatus: string;
}

const FIELD_METADATA: Record<
  string,
  { label: string; ruleCitation: string; placeholder: string; unitHint?: string }
> = {
  manufacturer_name_address: {
    label: "Manufacturer / Packer Details",
    ruleCitation: "LMPC Rule 6(1)(a) — Name, complete registered address, state/PIN",
    placeholder: "e.g., Mfd by Britannia Industries Ltd, 5/1A Hungerford Street, Kolkata - 700017",
  },
  common_name: {
    label: "Generic Commodity Name",
    ruleCitation: "LMPC Rule 6(1)(b) — Identity of product contained in package",
    placeholder: "e.g., Biscuits / Cookies / Extruded Snacks",
  },
  net_quantity: {
    label: "Net Quantity Declaration",
    ruleCitation: "LMPC Rule 6(1)(c) — Standard unit of weight/measure (g, ml, kg, L)",
    placeholder: "e.g., Net Qty: 250 g",
    unitHint: "Mandatory standard units: g, kg, ml, l, N",
  },
  mrp: {
    label: "Retail Sale Price (MRP)",
    ruleCitation: "LMPC Rule 6(1)(e) — Maximum Retail Price inclusive of all taxes",
    placeholder: "e.g., MRP Rs. 40.00 (incl. of all taxes)",
  },
  mfg_month_year: {
    label: "Date of Packaging / Import",
    ruleCitation: "LMPC Rule 6(1)(d) — Month & Year of manufacture or pre-packing",
    placeholder: "e.g., Mfd: 08/2026 / Pkd: Aug 2026",
  },
  consumer_care: {
    label: "Consumer Care Details",
    ruleCitation: "LMPC Rule 6(2) — Official name, address, phone/helpline, and email",
    placeholder: "e.g., For complaints: Manager, Consumer Care, Toll Free: 1800-XXX-XXXX, email: feedback@...",
  },
};

export const ExtractionReviewStudio: React.FC<ExtractionReviewStudioProps> = ({
  fields,
  previewUrl,
  onConfirmField,
  onConfirmAllHighConfidence,
  onSubmitEvaluation,
  onDiscard,
  loading,
  loadingStatus,
}) => {
  const [selectedField, setSelectedField] = useState<string | null>(
    fields.length > 0 ? fields[0].field_name : null
  );
  const [filterMode, setFilterMode] = useState<"all" | "attention" | "confirmed">("all");
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editDraftValues, setEditDraftValues] = useState<Record<string, string>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const confidenceThreshold = 0.75;

  const lowConfidenceCount = fields.filter((f) => f.confidence < confidenceThreshold).length;
  const confirmedCount = fields.filter((f) => Boolean(f.confirmed_value)).length;
  const allConfirmed = fields.length > 0 && confirmedCount === fields.length;

  const filteredFields = fields.filter((f) => {
    if (filterMode === "attention") return f.confidence < confidenceThreshold && !f.confirmed_value;
    if (filterMode === "confirmed") return Boolean(f.confirmed_value);
    return true;
  });

  const handleStartEdit = (fieldName: string, currentValue: string) => {
    setEditingField(fieldName);
    setEditDraftValues((prev) => ({ ...prev, [fieldName]: currentValue }));
  };

  const handleSaveEdit = (fieldName: string) => {
    const val = editDraftValues[fieldName] ?? "";
    onConfirmField(fieldName, val, "manual_edit");
    setEditingField(null);
  };

  return (
    <div className="space-y-6">
      {/* Studio Header Bar */}
      <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-5 shadow-xl backdrop-blur-md">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3">
              <div className="h-8 w-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <FileCheck className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">
                  Mandatory Packaging Verification Studio
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Phase 3 Verification Gate (PRD §3) • Confirm extracted declarations before deterministic rule evaluation
                </p>
              </div>
            </div>
          </div>

          {/* Quick Metrics & Actions */}
          <div className="flex items-center flex-wrap gap-2.5">
            <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs font-mono">
              <span className="text-slate-400">Verified:</span>
              <span className={allConfirmed ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                {confirmedCount} / {fields.length}
              </span>
            </div>

            {lowConfidenceCount > 0 && (
              <div className="flex items-center space-x-1.5 bg-amber-500/10 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-xl text-xs font-medium">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>{lowConfidenceCount} Flagged</span>
              </div>
            )}

            <button
              onClick={onConfirmAllHighConfidence}
              type="button"
              className="px-3.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Accept High-Confidence</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Workspace (Split Grid) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Package Canvas with Bounding Boxes (5 cols) */}
        <div className="lg:col-span-5 bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden sticky top-24 shadow-2xl flex flex-col">
          {/* Canvas Toolbar */}
          <div className="bg-slate-950/80 px-4 py-3 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold text-slate-300">Packaging Canvas</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                {Math.round(zoomLevel * 100)}%
              </span>
            </div>

            <div className="flex items-center space-x-1">
              <button
                onClick={() => setZoomLevel((z) => Math.max(0.7, z - 0.15))}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.15))}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setZoomLevel(1)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                title="Reset View"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Interactive Image Container */}
          <div className="relative bg-slate-950 p-4 min-h-[420px] max-h-[620px] overflow-auto flex items-center justify-center">
            {previewUrl ? (
              <div
                className="relative inline-block transition-transform duration-150 ease-out origin-top"
                style={{ transform: `scale(${zoomLevel})` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={previewUrl}
                  alt="Packaging label"
                  className="max-h-[520px] w-auto rounded-lg object-contain shadow-md"
                />

                {/* Bounding Boxes Overlay */}
                {fields.map((f) => {
                  const isSelected = selectedField === f.field_name;
                  const isLow = f.confidence < confidenceThreshold;
                  const [x, y, w, h] = f.bounding_box;

                  // Render bounding box if valid
                  if (w <= 0 || h <= 0) return null;

                  return (
                    <div
                      key={f.field_name}
                      onClick={() => setSelectedField(f.field_name)}
                      className={`absolute cursor-pointer transition-all duration-200 ${
                        isSelected
                          ? "ring-2 ring-cyan-400 bg-cyan-400/20 z-20 shadow-lg shadow-cyan-500/20"
                          : isLow
                          ? "border-2 border-dashed border-amber-400 bg-amber-400/10 z-10 hover:bg-amber-400/20"
                          : "border border-emerald-400/80 bg-emerald-400/10 z-0 hover:bg-emerald-400/20"
                      }`}
                      style={{
                        left: `${x}px`,
                        top: `${y}px`,
                        width: `${w}px`,
                        height: `${h}px`,
                      }}
                      title={`${f.field_name} (${Math.round(f.confidence * 100)}%)`}
                    >
                      {isSelected && (
                        <div className="absolute -top-6 left-0 bg-cyan-500 text-slate-950 text-[10px] font-bold px-2 py-0.5 rounded shadow whitespace-nowrap">
                          {FIELD_METADATA[f.field_name]?.label || f.field_name}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-slate-500 p-8">
                <Layers className="w-12 h-12 mx-auto text-slate-700 mb-2" />
                <p className="text-xs">No label image preview available</p>
              </div>
            )}
          </div>

          {/* Canvas Footer Legend */}
          <div className="bg-slate-950/90 px-4 py-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-emerald-400 inline-block" /> High Confidence
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-amber-400 border border-dashed inline-block" /> Attention
              </span>
            </div>
            <span className="font-mono text-[10px] text-slate-500">Click box to jump to field</span>
          </div>
        </div>

        {/* RIGHT COLUMN: Field Verification Deck (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Filter Segmented Control */}
          <div className="flex items-center justify-between">
            <div className="inline-flex p-1 bg-slate-900 border border-slate-800 rounded-xl">
              <button
                onClick={() => setFilterMode("all")}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  filterMode === "all" ? "bg-slate-800 text-white shadow" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                All Declarations ({fields.length})
              </button>
              <button
                onClick={() => setFilterMode("attention")}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  filterMode === "attention"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Needs Review ({lowConfidenceCount})
              </button>
              <button
                onClick={() => setFilterMode("confirmed")}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  filterMode === "confirmed"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Confirmed ({confirmedCount})
              </button>
            </div>

            <span className="text-xs text-slate-400 hidden sm:inline">
              Rule checks run strictly on <strong>Confirmed Values</strong>
            </span>
          </div>

          {/* Cards Stack */}
          <div className="space-y-4">
            {filteredFields.map((field) => {
              const meta = FIELD_METADATA[field.field_name] || {
                label: field.field_name,
                ruleCitation: "Mandatory statutory declaration",
                placeholder: "Enter value",
              };
              const isSelected = selectedField === field.field_name;
              const isLow = field.confidence < confidenceThreshold;
              const isConfirmed = Boolean(field.confirmed_value);
              const isEditing = editingField === field.field_name;

              const cropFullUrl = field.evidence_crop_url
                ? field.evidence_crop_url.startsWith("http")
                  ? field.evidence_crop_url
                  : `${API_BASE_URL}${field.evidence_crop_url}`
                : null;

              return (
                <div
                  key={field.field_name}
                  onClick={() => setSelectedField(field.field_name)}
                  className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                    isSelected
                      ? "border-cyan-500/50 bg-slate-900/90 shadow-xl shadow-cyan-500/5 ring-1 ring-cyan-500/30"
                      : isConfirmed
                      ? "border-emerald-500/30 bg-slate-900/60 shadow-sm"
                      : isLow
                      ? "border-amber-500/40 bg-amber-950/10 shadow-sm"
                      : "border-slate-800/90 bg-slate-900/50 hover:border-slate-700"
                  }`}
                >
                  {/* Card Header */}
                  <div className="p-4 sm:p-5 pb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="text-sm sm:text-base font-bold text-white">{meta.label}</h3>
                        {isConfirmed && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            <Check className="w-3 h-3" />
                            <span>Confirmed</span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{meta.ruleCitation}</p>
                    </div>

                    {/* Confidence Pill */}
                    <div className="flex items-center space-x-2">
                      <span
                        className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg border ${
                          isLow
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                            : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                        }`}
                      >
                        {Math.round(field.confidence * 100)}% Conf
                      </span>
                    </div>
                  </div>

                  {/* Card Body: Crop & Value Comparison */}
                  <div className="px-4 sm:px-5 pb-4 space-y-3">
                    {/* Visual Crop Evidence if available */}
                    {cropFullUrl && (
                      <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <Eye className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Detected Packaging Snippet:</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={cropFullUrl}
                            alt="Crop preview"
                            className="h-10 max-w-[200px] object-contain rounded border border-slate-700 bg-white"
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setLightboxUrl(cropFullUrl);
                            }}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                            title="Expand Crop"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Extracted Value Display / Edit Form */}
                    {isEditing ? (
                      <div className="space-y-2 bg-slate-950 p-3 rounded-xl border border-cyan-500/40">
                        <label className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider block">
                          Manual Value Correction
                        </label>
                        <textarea
                          rows={2}
                          value={editDraftValues[field.field_name] ?? ""}
                          onChange={(e) =>
                            setEditDraftValues((prev) => ({
                              ...prev,
                              [field.field_name]: e.target.value,
                            }))
                          }
                          placeholder={meta.placeholder}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs sm:text-sm text-white font-mono focus:outline-none focus:border-cyan-400"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setEditingField(null)}
                            type="button"
                            className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveEdit(field.field_name)}
                            type="button"
                            className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white shadow"
                          >
                            Save & Confirm
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {/* Current Active Value */}
                        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                              {field.confirmed_value ? "Confirmed Value" : "Extracted Raw Value"}
                            </span>
                            <span className="text-[10px] font-mono text-slate-500">
                              via {field.ocr_source}
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm text-slate-100 font-mono break-words">
                            {field.confirmed_value || field.raw_value || (
                              <span className="text-rose-400 italic">No declaration detected</span>
                            )}
                          </p>
                        </div>

                        {/* AI Suggested Value (if present and different from raw) */}
                        {field.suggested_value && field.suggested_value !== field.raw_value && (
                          <div className="bg-purple-950/20 border border-purple-500/30 p-2.5 rounded-xl flex items-center justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5 text-purple-300 text-xs font-semibold">
                                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                                <span>AI Typo Correction ({field.suggestion_source || "Perception"}):</span>
                              </div>
                              <p className="text-xs text-slate-200 font-mono break-words">
                                &ldquo;{field.suggested_value}&rdquo;
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                onConfirmField(field.field_name, field.suggested_value!, "accepted_suggestion")
                              }
                              type="button"
                              className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold whitespace-nowrap shadow transition-colors"
                            >
                              Use AI Fix
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Quick Action Bar */}
                    {!isEditing && (
                      <div className="pt-2 flex items-center justify-between border-t border-slate-800/80 gap-2">
                        <button
                          onClick={() => handleStartEdit(field.field_name, field.confirmed_value || field.raw_value)}
                          type="button"
                          className="px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-slate-400" />
                          <span>Manual Edit</span>
                        </button>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onConfirmField(field.field_name, field.raw_value, "accepted_raw")}
                            type="button"
                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                              field.confirmed_value === field.raw_value
                                ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                                : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{field.confirmed_value === field.raw_value ? "Accepted" : "Accept Raw"}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sticky Bottom Final Submission Bar */}
          <div className="sticky bottom-4 bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4 z-30">
            <div className="text-xs text-slate-300 flex items-center gap-2">
              {allConfirmed ? (
                <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> All {fields.length} packaging declarations confirmed.
                </span>
              ) : (
                <span className="text-amber-400 font-medium flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4" /> Confirm remaining declarations ({fields.length - confirmedCount} left).
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                onClick={onDiscard}
                type="button"
                className="px-4 py-2.5 text-xs text-slate-400 hover:text-white transition-colors"
              >
                Discard & Upload New
              </button>
              <button
                onClick={onSubmitEvaluation}
                disabled={!allConfirmed || loading}
                type="button"
                className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 text-white rounded-xl text-xs sm:text-sm font-bold transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <span className="animate-spin mr-1">⏳</span>
                ) : (
                  <ShieldCheck className="w-4 h-4 text-white" />
                )}
                <span>{loading ? loadingStatus : "Run Statutory Rule Evaluation →"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 max-w-xl max-h-[85vh] overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxUrl}
              alt="Evidence high-res crop"
              className="max-h-[70vh] w-auto mx-auto object-contain rounded-lg bg-white"
            />
            <div className="mt-3 text-center">
              <button
                onClick={() => setLightboxUrl(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white rounded-lg"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
