"use client";

import React, { useState } from "react";
import { ExtractedField, API_BASE_URL } from "@/lib/api";

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

const FIELD_METADATA: Record<string, { label: string; ruleCitation: string; placeholder: string }> = {
  manufacturer_name_address: {
    label: "Manufacturer / packer details",
    ruleCitation: "LMPC Rule 6(1)(a)",
    placeholder: "e.g., Mfd by Britannia Industries Ltd, 5/1A Hungerford Street, Kolkata - 700017",
  },
  common_name: {
    label: "Generic commodity name",
    ruleCitation: "LMPC Rule 6(1)(b)",
    placeholder: "e.g., Biscuits / Cookies / Extruded Snacks",
  },
  net_quantity: {
    label: "Net quantity declaration",
    ruleCitation: "LMPC Rule 6(1)(c)",
    placeholder: "e.g., Net Qty: 250 g",
  },
  mrp: {
    label: "Retail sale price (MRP)",
    ruleCitation: "LMPC Rule 6(1)(e)",
    placeholder: "e.g., MRP Rs. 40.00 (incl. of all taxes)",
  },
  mfg_month_year: {
    label: "Date of packaging / import",
    ruleCitation: "LMPC Rule 6(1)(d)",
    placeholder: "e.g., Mfd: 08/2026 / Pkd: Aug 2026",
  },
  consumer_care: {
    label: "Consumer care details",
    ruleCitation: "LMPC Rule 6(2)",
    placeholder: "e.g., Consumer Care: 1800-XXX-XXXX, email: feedback@...",
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
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const imageRef = React.useRef<HTMLImageElement | null>(null);

  const confidenceThreshold = 0.75;
  const lowConfidenceCount = fields.filter((f) => f.confidence < confidenceThreshold).length;
  const confirmedCount = fields.filter((f) => Boolean(f.confirmed_value)).length;
  const allConfirmed = fields.length > 0 && confirmedCount === fields.length;

  const filteredFields = fields.filter((f) => {
    if (filterMode === "attention") return f.confidence < confidenceThreshold && !f.confirmed_value;
    if (filterMode === "confirmed") return Boolean(f.confirmed_value);
    return true;
  });

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setImageNaturalSize({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    }
  };

  React.useEffect(() => {
    setImageNaturalSize(null);
    if (imageRef.current && imageRef.current.complete && imageRef.current.naturalWidth > 0) {
      setImageNaturalSize({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight,
      });
    }
  }, [previewUrl]);

  const handleSelectField = (fieldName: string) => {
    setSelectedField(fieldName);
    const el = document.getElementById(`field-row-${fieldName}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

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
    <div className="flex flex-col space-y-2 animate-fadeIn">
      {/* Sleek Studio Header */}
      <div className="shrink-0 flex items-center justify-between gap-3 pb-2 border-b border-hairline">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-heading font-semibold text-ink tracking-tight">
            Extraction review
          </h1>
          <span className="text-hairline text-xs hidden sm:inline">&bull;</span>
          <span className="font-mono text-xs text-ink-light">
            {confirmedCount} of {fields.length} confirmed
          </span>
          {lowConfidenceCount > 0 && (
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-ochre-light/40 text-ochre border border-ochre/30 font-semibold">
              {lowConfidenceCount} flagged
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onConfirmAllHighConfidence}
            type="button"
            className="px-2.5 py-1.5 rounded-md border border-hairline bg-paper hover:bg-wash text-xs font-medium text-ink transition-colors cursor-pointer"
          >
            Accept high-confidence
          </button>
          <button
            onClick={onDiscard}
            type="button"
            className="px-2.5 py-1.5 rounded-md border border-hairline bg-paper hover:bg-wash text-xs font-medium text-ink-light hover:text-ink transition-colors cursor-pointer"
          >
            Discard
          </button>
          <button
            onClick={onSubmitEvaluation}
            disabled={!allConfirmed || loading}
            type="button"
            className="px-4 py-1.5 bg-seal hover:bg-seal-light disabled:opacity-40 text-white rounded-md text-xs font-heading font-semibold transition-colors flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed shadow-xs"
          >
            {loading && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
            <span>Run evaluation &rarr;</span>
          </button>
        </div>
      </div>

      {/* Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-start">
        {/* LEFT: Package Image - Sticky */}
        <div className="lg:col-span-5 bg-wash border border-hairline rounded-lg overflow-hidden flex flex-col lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)]">
          {/* Toolbar */}
          <div className="px-4 py-2 border-b border-hairline flex items-center justify-between shrink-0 bg-white">
            <span className="text-xs font-semibold text-ink flex items-center gap-1.5 font-mono">
              <span className="material-symbols-outlined text-[15px] text-seal">crop_free</span>
              Packaging canvas
            </span>
            <div className="flex items-center gap-1 text-ink-light">
              <button
                onClick={() => setZoomLevel((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
                className="w-6 h-6 rounded flex items-center justify-center hover:bg-wash transition-colors text-xs font-bold cursor-pointer"
                title="Zoom out"
              >
                −
              </button>
              <span className="text-[11px] font-mono w-11 text-center font-medium text-ink">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                onClick={() => setZoomLevel((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))}
                className="w-6 h-6 rounded flex items-center justify-center hover:bg-wash transition-colors text-xs font-bold cursor-pointer"
                title="Zoom in"
              >
                +
              </button>
              <button
                onClick={() => setZoomLevel(1)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-mono ml-1 transition-colors cursor-pointer ${
                  zoomLevel === 1 ? "bg-seal/10 text-seal font-semibold" : "hover:bg-wash text-ink-light hover:text-ink"
                }`}
                title="Fit image to view"
              >
                Fit
              </button>
              {previewUrl && (
                <button
                  onClick={() => setLightboxUrl(previewUrl)}
                  className="p-1 rounded hover:bg-wash transition-colors text-ink-light hover:text-ink ml-1 cursor-pointer flex items-center"
                  title="Enlarge to full-screen view"
                >
                  <span className="material-symbols-outlined text-[16px]">fullscreen</span>
                </button>
              )}
            </div>
          </div>

          {/* Image Canvas */}
          <div className="relative bg-paper/60 p-3 flex-1 min-h-0 overflow-auto">
            {previewUrl ? (
              <div className="w-full h-full flex items-center justify-center min-w-fit min-h-fit">
                <div
                  className="relative inline-block select-none transition-transform duration-150 ease-out"
                  style={{
                    transform: zoomLevel !== 1 ? `scale(${zoomLevel})` : undefined,
                    transformOrigin: "center center",
                    maxHeight: zoomLevel === 1 ? "100%" : undefined,
                    maxWidth: zoomLevel === 1 ? "100%" : undefined,
                  }}
                >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imageRef}
                  src={previewUrl}
                  alt="Packaging label"
                  onLoad={handleImageLoad}
                  className="rounded border border-hairline bg-white shadow-xs block select-none"
                  style={{
                    objectFit: "contain",
                    maxHeight: zoomLevel === 1 ? "100%" : undefined,
                    maxWidth: zoomLevel === 1 ? "100%" : undefined,
                  }}
                />

                {/* Bounding Boxes Overlays */}
                {imageNaturalSize && fields.map((f) => {
                  const isSelected = selectedField === f.field_name;
                  const isLow = f.confidence < confidenceThreshold;
                  const [x, y, w, h] = f.bounding_box || [0, 0, 0, 0];
                  if (w <= 0 || h <= 0) return null;

                  // Ignore dummy uninitialized fallback coordinates (0, 0, 100, 50) when no text was detected
                  if (x === 0 && y === 0 && ((w === 100 && h <= 100) || !f.raw_value || f.raw_value.trim() === "")) {
                    return null;
                  }

                  // Precise percentage calculations relative to the original source image dimensions
                  const leftPct = (x / imageNaturalSize.width) * 100;
                  const topPct = (y / imageNaturalSize.height) * 100;
                  const widthPct = (w / imageNaturalSize.width) * 100;
                  const heightPct = (h / imageNaturalSize.height) * 100;

                  return (
                    <div
                      key={f.field_name}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectField(f.field_name);
                      }}
                      className={`absolute cursor-pointer transition-all duration-150 rounded-xs ${
                        isLow
                          ? `border-dashed border-orange-500 bg-orange-500/20 hover:bg-orange-500/30 ${isSelected ? "border-[3px] z-30 shadow-md ring-2 ring-orange-400" : "border-[2px] z-10"}`
                          : `border-green-500 bg-green-500/20 hover:bg-green-500/30 ${isSelected ? "border-[3px] z-30 shadow-md ring-2 ring-green-400" : "border-[2px] z-0"}`
                      } print:bg-transparent print:border-2`}
                      style={{
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        width: `${widthPct}%`,
                        height: `${heightPct}%`,
                        minWidth: "6px",
                        minHeight: "6px",
                      }}
                      title={`${FIELD_METADATA[f.field_name]?.label || f.field_name}: ${f.raw_value || "—"} (${Math.round(f.confidence * 100)}%)`}
                    >
                      <div className={`absolute top-0 left-full ml-1 ${isLow ? "bg-orange-500" : "bg-green-500"} text-white text-[11px] font-bold px-2 py-1 rounded-sm shadow-sm whitespace-nowrap z-40 pointer-events-none flex items-center gap-1`}>
                        <span>{FIELD_METADATA[f.field_name]?.label || f.field_name}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              </div>
            ) : (
              <div className="text-center text-ink-light p-8">
                <p className="text-sm">No label image preview available</p>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="px-4 py-2 border-t border-hairline flex items-center justify-between text-[11px] text-ink-light shrink-0 bg-white">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-stamp-green/40 border border-stamp-green/70 inline-block" /> High confidence
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-ochre/30 border border-dashed border-ochre inline-block" /> Needs review
              </span>
            </div>
            <span className="font-mono text-[10px] hidden sm:inline">Click overlay box to select</span>
          </div>
        </div>

        {/* RIGHT: Field Verification - Scrollable column */}
        <div className="lg:col-span-7 flex flex-col">
          {/* Filter Tabs */}
          <div className="flex items-center justify-between border-b border-hairline shrink-0 pb-1">
            <div className="flex items-center gap-0">
              {[
                { mode: "all" as const, label: `All (${fields.length})` },
                { mode: "attention" as const, label: `Needs review (${lowConfidenceCount})` },
                { mode: "confirmed" as const, label: `Confirmed (${confirmedCount})` },
              ].map(({ mode, label }) => (
                <button
                  key={mode}
                  onClick={() => setFilterMode(mode)}
                  className={`px-3 py-2 text-xs font-medium transition-all border-b-2 cursor-pointer ${
                    filterMode === mode
                      ? "border-seal text-ink"
                      : "border-transparent text-ink-light hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-ink-light hidden sm:inline pb-2">
              Rules run on <strong className="text-ink">confirmed values</strong> only
            </span>
          </div>

          {/* Ledger Rows - Scrollable container */}
          <div className="flex flex-col divide-y divide-hairline pr-2 py-1">
            {filteredFields.map((field) => {
              const meta = FIELD_METADATA[field.field_name] || {
                label: field.field_name.replace(/_/g, " "),
                ruleCitation: "Mandatory declaration",
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
                  id={`field-row-${field.field_name}`}
                  onClick={() => setSelectedField(field.field_name)}
                  className={`py-4 cursor-pointer transition-colors ${
                    isSelected ? "bg-wash/60 -mx-3 px-3 rounded" : ""
                  } ${isLow && !isConfirmed ? "border-l-3 border-l-ochre pl-3 -ml-3" : ""}`}
                >
                  {/* Row Header */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-heading font-semibold text-ink">
                        {meta.label}
                      </h3>
                      {isConfirmed && (
                        <span className="text-stamp-green text-xs">✓</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[11px] font-mono text-ink-light">
                        {meta.ruleCitation}
                      </span>
                      <span
                        className={`text-[11px] font-mono font-medium px-2 py-0.5 rounded ${
                          isLow
                            ? "bg-ochre-light text-ochre"
                            : "bg-stamp-green-light text-stamp-green"
                        }`}
                      >
                        {Math.round(field.confidence * 100)}%
                      </span>
                    </div>
                  </div>

                  {/* Evidence Crop */}
                  {cropFullUrl && (
                    <div className="flex items-center gap-3 mb-2 text-xs text-ink-light">
                      <span>Detected snippet:</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={cropFullUrl}
                        alt="Crop preview"
                        className="h-8 max-w-[180px] object-contain rounded border border-hairline bg-white cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); setLightboxUrl(cropFullUrl); }}
                      />
                    </div>
                  )}

                  {/* Editing Mode */}
                  {isEditing ? (
                    <div
                      className="space-y-2 bg-paper p-3 rounded-md border border-seal/30 mt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label className="text-[11px] font-medium text-seal block">
                        Manual value correction
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
                        className="w-full bg-white border border-hairline rounded-md p-2.5 text-sm text-ink font-mono focus:outline-none focus:border-seal"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditingField(null)}
                          type="button"
                          className="px-3 py-1.5 text-xs text-ink-light hover:text-ink cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSaveEdit(field.field_name)}
                          type="button"
                          className="px-4 py-1.5 rounded-md bg-seal text-white text-xs font-medium cursor-pointer"
                        >
                          Save &amp; confirm
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Current Value */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] text-ink-light block mb-0.5">
                            {field.confirmed_value ? "Confirmed value" : "Extracted raw value"}
                            <span className="ml-2 font-mono text-[10px]">via {field.ocr_source}</span>
                          </span>
                          <p className="text-sm text-ink font-mono break-words">
                            {field.confirmed_value || field.raw_value || (
                              <span className="text-brick italic">No declaration detected</span>
                            )}
                          </p>
                        </div>
                      </div>

                      {/* AI Suggestion */}
                      {field.suggested_value && field.suggested_value !== field.raw_value && (
                        <div
                          className="bg-wash border border-hairline p-2.5 rounded-md flex items-center justify-between gap-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="space-y-0.5 flex-1 min-w-0">
                            <span className="text-xs font-medium text-seal">
                              AI correction ({field.suggestion_source || "Perception"}):
                            </span>
                            <p className="text-xs text-ink font-mono break-words">
                              &ldquo;{field.suggested_value}&rdquo;
                            </p>
                          </div>
                          <button
                            onClick={() =>
                              onConfirmField(
                                field.field_name,
                                field.suggested_value!,
                                "accepted_suggestion"
                              )
                            }
                            type="button"
                            className="px-3 py-1.5 rounded-md bg-seal text-white text-xs font-medium whitespace-nowrap cursor-pointer"
                          >
                            Use fix
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action Bar */}
                  {!isEditing && (
                    <div
                      className="pt-2 mt-2 flex items-center justify-between gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() =>
                          handleStartEdit(
                            field.field_name,
                            field.confirmed_value || field.raw_value
                          )
                        }
                        type="button"
                        className="text-xs text-ink-light hover:text-ink font-medium cursor-pointer"
                      >
                        Edit manually
                      </button>
                      <button
                        onClick={() =>
                          onConfirmField(field.field_name, field.raw_value, "accepted_raw")
                        }
                        type="button"
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                          field.confirmed_value === field.raw_value
                            ? "bg-stamp-green text-white"
                            : "border border-hairline bg-paper hover:bg-wash text-ink"
                        }`}
                      >
                        {field.confirmed_value === field.raw_value ? "Accepted ✓" : "Accept raw"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom Submission Bar */}
          <div className="shrink-0 bg-wash border border-hairline rounded-lg p-3.5 mt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs text-ink">
              {allConfirmed ? (
                <span className="text-stamp-green font-medium">
                  ✓ All {fields.length} declarations confirmed.
                </span>
              ) : (
                <span className="text-ink-light">
                  Confirm remaining declarations ({fields.length - confirmedCount} left).
                </span>
              )}
            </span>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                onClick={onDiscard}
                type="button"
                className="text-xs text-ink-light hover:text-ink cursor-pointer"
              >
                Discard &amp; upload new
              </button>
              <button
                onClick={onSubmitEvaluation}
                disabled={!allConfirmed || loading}
                type="button"
                className="w-full sm:w-auto px-5 py-2.5 bg-seal hover:bg-seal-light disabled:opacity-40 text-white rounded-md text-sm font-heading font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                ) : null}
                <span>{loading ? loadingStatus : "Run statutory evaluation →"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-ink/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className="bg-white border border-hairline rounded-xl p-4 max-w-4xl max-h-[90vh] overflow-hidden shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-hairline shrink-0">
              <span className="text-xs font-mono font-semibold text-ink flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-seal">zoom_in</span>
                High-Resolution Inspection Preview
              </span>
              <button
                onClick={() => setLightboxUrl(null)}
                className="text-ink-light hover:text-ink text-sm p-1 rounded hover:bg-wash transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2 flex items-center justify-center min-h-0 my-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxUrl}
                alt="High-resolution inspection view"
                className="max-h-[75vh] w-auto mx-auto object-contain rounded border border-hairline shadow-xs"
              />
            </div>
            <div className="pt-2 border-t border-hairline flex items-center justify-end shrink-0">
              <button
                onClick={() => setLightboxUrl(null)}
                className="px-4 py-1.5 bg-seal hover:bg-seal-light text-xs font-medium text-white rounded-md cursor-pointer transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
