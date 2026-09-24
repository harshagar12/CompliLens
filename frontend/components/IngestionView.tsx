"use client";

import React from "react";

interface IngestionViewProps {
  selectedFile: File | null;
  previewUrl: string | null;
  category: string;
  ocrProvider: string;
  loading: boolean;
  loadingStatus: string;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onLoadSample: () => void;
  onClearFile: () => void;
  onCategoryChange: (v: string) => void;
  onOcrChange: (v: string) => void;
  onStartInspection: () => void;
}

export const IngestionView: React.FC<IngestionViewProps> = ({
  selectedFile,
  previewUrl,
  category,
  ocrProvider,
  loading,
  loadingStatus,
  onFileChange,
  onLoadSample,
  onClearFile,
  onCategoryChange,
  onOcrChange,
  onStartInspection,
}) => {
  return (
    <div className="w-full space-y-4 animate-fadeIn">
      {/* Header on top of the 2 panels */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-hairline pb-3">
        <div className="space-y-2 max-w-4xl">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-heading font-semibold text-ink tracking-tight">
              Package label inspection
            </h1>
            <span className="text-xs font-mono text-ink-light hidden sm:inline">&bull; LMPC Rules, 2011</span>
          </div>
          <p className="text-xs text-ink-light">
            Upload packaging artwork or label photographs to evaluate statutory declarations under Legal Metrology Rules, 2011.
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-ink-light mr-1">
              Checks:
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-wash border border-hairline text-[11px] font-mono text-ink">
              <span className="text-stamp-green font-bold">&bull;</span> Mfg &amp; Packer (R6.1a)
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-wash border border-hairline text-[11px] font-mono text-ink">
              <span className="text-stamp-green font-bold">&bull;</span> Commodity Name (R6.1b)
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-wash border border-hairline text-[11px] font-mono text-ink">
              <span className="text-stamp-green font-bold">&bull;</span> Net Quantity (R6.1c)
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-wash border border-hairline text-[11px] font-mono text-ink">
              <span className="text-stamp-green font-bold">&bull;</span> MRP (R6.1e)
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-wash border border-hairline text-[11px] font-mono text-ink">
              <span className="text-stamp-green font-bold">&bull;</span> Packaging Date (R6.1d)
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-wash border border-hairline text-[11px] font-mono text-ink">
              <span className="text-stamp-green font-bold">&bull;</span> Consumer Care (R6.2)
            </span>
          </div>
        </div>

        {!previewUrl && (
          <button
            onClick={onLoadSample}
            type="button"
            className="text-xs text-seal font-medium hover:underline cursor-pointer flex items-center gap-1.5 self-start sm:self-auto shrink-0 mt-1"
          >
            <span className="material-symbols-outlined text-[16px]">science</span>
            Load sample label
          </button>
        )}
      </div>

      {/* The 2 Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* LEFT PANEL: Upload Dropzone & Canvas (8 cols) */}
        <div className="lg:col-span-8">
          <div
            className={`border-2 border-dashed rounded-xl p-6 sm:p-8 text-center transition-all ${
              previewUrl
                ? "border-hairline bg-wash/60"
                : "border-hairline bg-wash/30 hover:border-seal hover:bg-wash/50"
            }`}
          >
            {previewUrl ? (
              <div className="space-y-4">
                <div className="relative group max-w-xl mx-auto">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Packaging label preview"
                    className="max-h-[440px] w-auto mx-auto rounded-lg border border-hairline object-contain bg-white shadow-sm"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-hairline text-xs font-mono">
                  <div className="flex items-center gap-2 text-ink">
                    <span className="material-symbols-outlined text-[16px] text-stamp-green">check_circle</span>
                    <span className="font-semibold truncate max-w-md">{selectedFile?.name || "label_artwork.jpg"}</span>
                    {selectedFile && (
                      <span className="text-ink-light">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
                    )}
                  </div>
                  <button
                    onClick={onClearFile}
                    type="button"
                    className="text-brick text-xs font-medium hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                    Remove &amp; select another
                  </button>
                </div>
              </div>
            ) : (
              <label className="cursor-pointer flex flex-col items-center justify-center space-y-4 py-12">
                <div className="w-16 h-16 rounded-full bg-paper border border-hairline flex items-center justify-center text-seal shadow-xs">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div className="space-y-1 text-center">
                  <span className="text-base font-heading font-semibold text-ink block">
                    Drop packaging label image here, or browse files
                  </span>
                  <p className="text-xs text-ink-light max-w-md mx-auto font-body">
                    Upload high-resolution label scans, principal display panels, or photographs.
                  </p>
                  <span className="text-xs text-ink-light block font-mono pt-0.5">
                    PNG, JPG, JPEG, WebP &bull; Maximum 15 MB
                  </span>
                </div>
                <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-seal hover:bg-seal-light text-xs font-medium text-white shadow-xs transition-colors cursor-pointer mt-1">
                  <span className="material-symbols-outlined text-[16px]">upload_file</span>
                  Select packaging file
                </span>
                <input type="file" accept="image/*" onChange={onFileChange} className="hidden" />
              </label>
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Configuration & Statutory Scope (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Configuration Card */}
          <div className="bg-white border border-hairline rounded-xl p-5 space-y-4 shadow-xs">
            <h3 className="text-xs font-bold text-ink uppercase tracking-wider font-mono flex items-center gap-2 border-b border-hairline pb-2.5">
              <span className="material-symbols-outlined text-seal text-[16px]">tune</span>
              Inspection parameters
            </h3>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-ink block">
                Product category
              </label>
              <select
                value={category}
                onChange={(e) => onCategoryChange(e.target.value)}
                className="w-full bg-paper border border-hairline rounded-md p-2.5 text-xs text-ink focus:outline-none focus:border-seal font-body cursor-pointer"
              >
                <option value="packaged_food">Packaged food (Full Rule 6 declarations)</option>
                <option value="restaurant_fast_food">Restaurant fast food (Exempt Rule 26.b)</option>
                <option value="scheduled_drug_formulation">Scheduled drug formulation (Exempt Rule 26.c)</option>
              </select>
              <span className="text-[11px] text-ink-light block">
                Applies statutory exemption filters for specific categories.
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-ink block">
                Perception OCR engine
              </label>
              <select
                value={ocrProvider}
                onChange={(e) => onOcrChange(e.target.value)}
                className="w-full bg-paper border border-hairline rounded-md p-2.5 text-xs text-ink focus:outline-none focus:border-seal font-body cursor-pointer"
              >
                <option value="rapidocr">RapidOCR (Local CPU)</option>
                <option value="gemini-vision">Gemini Flash Vision (Cloud)</option>
                <option value="google-cloud-vision">Google Cloud Vision API</option>
              </select>
              <span className="text-[11px] text-ink-light block">
                Extraction pipeline for dot-matrix codes and small fonts.
              </span>
            </div>

            {/* Action CTA Button */}
            <div className="pt-2">
              <button
                onClick={onStartInspection}
                disabled={!selectedFile || loading}
                className="w-full py-3 px-6 bg-seal hover:bg-seal-light disabled:opacity-40 text-white font-heading font-semibold text-sm rounded-md transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed shadow-sm"
              >
                {loading ? (
                  <>
                    <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                    <span>{loadingStatus}</span>
                  </>
                ) : (
                  <>
                    <span>Start extraction &amp; audit</span>
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
