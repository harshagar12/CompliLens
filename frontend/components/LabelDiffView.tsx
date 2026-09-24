"use client";

import React, { useState } from "react";
import {
  GitCompare,
  AlertOctagon,
  CheckCheck,
  RefreshCw,
  UploadCloud,
  X,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  ShieldCheck,
  Calendar,
  AlertTriangle,
  ArrowRight,
  Info,
  CheckCircle2,
  ListOrdered,
  Eye,
  FileText,
  BadgeAlert,
  ArrowLeft,
  ArrowUpDown,
  MoveLeft,
  MoveRight,
  Maximize2,
  ZoomIn,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { batchExtractLabels, batchEvaluateLabels, API_BASE_URL } from "../lib/api";

const STATUTORY_FIELD_LABELS: Record<string, string> = {
  common_name: "Commodity Name",
  mrp: "MRP (Maximum Retail Price)",
  net_quantity: "Net Quantity",
  mfg_month_year: "Month & Year of Mfg/Packing",
  manufacturer_name_address: "Manufacturer Name & Address",
  consumer_care: "Consumer Care Details",
};

export const LabelDiffView: React.FC = () => {
  // ---------------------------------------------------------------------------
  // Stage 1: Upload State & Reordering
  // ---------------------------------------------------------------------------
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [optInReview, setOptInReview] = useState(false);
  const [autoSortByDate, setAutoSortByDate] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>("");

  // Workflow State: "upload" | "review" | "results"
  const [workflowState, setWorkflowState] = useState<"upload" | "review" | "results">("upload");

  // ---------------------------------------------------------------------------
  // Stage 2: Extracted Declarations & Review State
  // ---------------------------------------------------------------------------
  const [extractedPackages, setExtractedPackages] = useState<any[]>([]);
  const [activeReviewTab, setActiveReviewTab] = useState(0);
  const [reviewSection, setReviewSection] = useState<"statutory" | "ingredients" | "allergens" | "nutrition" | "claims">("statutory");

  // ---------------------------------------------------------------------------
  // Stage 3: Evaluation & Diff Results State
  // ---------------------------------------------------------------------------
  const [diffResult, setDiffResult] = useState<any | null>(null);
  const [activeDiffTab, setActiveDiffTab] = useState<"variance" | "lmpc" | "ingredients" | "allergens" | "nutrition">("variance");
  const [expandedRules, setExpandedRules] = useState<Record<string, boolean>>({});

  // ---------------------------------------------------------------------------
  // File Upload Handlers & Reordering
  // ---------------------------------------------------------------------------
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    addFiles(files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const files = Array.from(e.dataTransfer.files);
      addFiles(files);
    }
  };

  const addFiles = (files: File[]) => {
    const valid = files.filter((f) => f.type.startsWith("image/"));
    const combined = [...selectedFiles, ...valid].slice(0, 5); // Max 5
    setSelectedFiles(combined);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(selectedFiles.filter((_, i) => i !== index));
  };

  const moveFile = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= selectedFiles.length) return;
    const updated = [...selectedFiles];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    setSelectedFiles(updated);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropOnCard = (targetIndex: number) => {
    if (draggedIndex === null || draggedIndex === targetIndex) return;
    moveFile(draggedIndex, targetIndex);
    setDraggedIndex(null);
  };

  // ---------------------------------------------------------------------------
  // Processing Pipeline
  // ---------------------------------------------------------------------------
  const handleStartAnalysis = async () => {
    if (selectedFiles.length < 2) {
      alert("Please upload at least 2 package label images (up to 5) to perform a multi-revision diff.");
      return;
    }
    setLoading(true);
    setLoadingStep("Running local RapidOCR perception on revisions...");

    try {
      const extractRes = await batchExtractLabels(selectedFiles);
      setExtractedPackages(extractRes.packages);

      if (optInReview) {
        // User opted to review extracted declarations
        setWorkflowState("review");
        setActiveReviewTab(0);
        setLoading(false);
      } else {
        // Direct flow: immediately evaluate and diff
        await executeEvaluation(extractRes.packages, autoSortByDate);
      }
    } catch (err: any) {
      alert(err.message || "Failed to process label revisions.");
      setLoading(false);
    }
  };

  const executeEvaluation = async (packagesToEval: any[], sortDate: boolean) => {
    setLoading(true);
    setLoadingStep("Evaluating Legal Metrology rules, shrinkflation, and formulation shifts...");

    try {
      const payload = packagesToEval.map((p) => ({
        package_id: p.package_id,
        category: "packaged_food",
        fields: p.fields,
        full_text: p.full_text || "",
        non_statutory: p.extracted_non_statutory || {},
      }));

      const diffRes = await batchEvaluateLabels(payload, sortDate);
      setDiffResult(diffRes);
      setWorkflowState("results");
    } catch (err: any) {
      alert(err.message || "Failed to evaluate package revisions.");
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Stage 2 Review Updaters
  // ---------------------------------------------------------------------------
  const handleUpdateFieldValue = (pkgIndex: number, fieldName: string, value: string) => {
    const updated = [...extractedPackages];
    if (updated[pkgIndex]) {
      if (!updated[pkgIndex].fields) {
        updated[pkgIndex].fields = {};
      }
      if (!updated[pkgIndex].fields[fieldName]) {
        updated[pkgIndex].fields[fieldName] = { field_name: fieldName, raw_value: value, confirmed_value: value, confidence: 1.0 };
      } else {
        updated[pkgIndex].fields[fieldName].confirmed_value = value;
        updated[pkgIndex].fields[fieldName].raw_value = value;
      }
      setExtractedPackages(updated);
    }
  };

  const handleUpdateNonStatutory = (pkgIndex: number, key: string, value: any) => {
    const updated = [...extractedPackages];
    if (updated[pkgIndex]) {
      if (!updated[pkgIndex].extracted_non_statutory) {
        updated[pkgIndex].extracted_non_statutory = {};
      }
      updated[pkgIndex].extracted_non_statutory[key] = value;
      if (key === "ingredients_text" && typeof value === "string") {
        const parts = value.split(/[,;]\s*(?![^()]*\))/).map((s: string) => s.trim()).filter(Boolean);
        updated[pkgIndex].extracted_non_statutory.ingredients_list = parts;
      }
      setExtractedPackages(updated);
    }
  };

  const handleReset = () => {
    setSelectedFiles([]);
    setExtractedPackages([]);
    setDiffResult(null);
    setWorkflowState("upload");
  };

  const toggleRuleExpand = (ruleId: string) => {
    setExpandedRules((prev) => ({ ...prev, [ruleId]: !prev[ruleId] }));
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-cyan-400" />
            Multi-Revision Label Diff & Packaging Evolution Inspector
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Audit Legal Metrology (LMPC) compliance conditions, shrinkflation, ingredient formulation shifts, and allergen risks across 2 to 5 packaging revisions.
          </p>
        </div>
        {workflowState !== "upload" && (
          <button
            onClick={handleReset}
            className="self-start sm:self-auto px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            New Comparison
          </button>
        )}
      </div>

      {/* ========================================================================= */}
      {/* STAGE 1: BATCH UPLOAD WITH DRAG-AND-DROP VERSION ORDERING */}
      {/* ========================================================================= */}
      {workflowState === "upload" && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-6">
          {/* Upload Dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="border-2 border-dashed border-slate-700 hover:border-cyan-500/60 bg-slate-950/40 rounded-xl p-8 text-center transition-colors cursor-pointer"
            onClick={() => document.getElementById("multi-diff-file-input")?.click()}
          >
            <input
              id="multi-diff-file-input"
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="flex flex-col items-center justify-center space-y-2">
              <div className="p-3 bg-cyan-500/10 rounded-full text-cyan-400 border border-cyan-500/20">
                <UploadCloud className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-200">
                Drag and drop 2 to 5 package label images, or click to browse
              </p>
              <p className="text-xs text-slate-400">
                Supported formats: PNG, JPG, JPEG, WebP • Minimum 2, Maximum 5 labels
              </p>
            </div>
          </div>

          {/* Selected File Previews with Version Ordering Controls */}
          {selectedFiles.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Packaging Lineage Order ({selectedFiles.length} of 5 max)
                  </span>
                  <p className="text-[11px] text-slate-400">
                    Drag cards or use arrow buttons to set chronological order (Rev 1 is oldest baseline).
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setAutoSortByDate(!autoSortByDate)}
                    className={`px-2.5 py-1 rounded text-xs font-mono transition-colors border ${
                      autoSortByDate
                        ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-bold"
                        : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white"
                    }`}
                  >
                    Auto-Sort by Mfg Date: {autoSortByDate ? "ON" : "OFF"}
                  </button>
                  <span className="text-xs text-cyan-400 font-mono bg-cyan-950/40 border border-cyan-800/40 px-2 py-1 rounded">
                    Engine: RapidOCR
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {selectedFiles.map((file, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === selectedFiles.length - 1;

                  return (
                    <div
                      key={idx}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={handleDragOver}
                      onDrop={() => handleDropOnCard(idx)}
                      className={`bg-slate-950 border rounded-lg p-2.5 relative flex flex-col justify-between transition-all cursor-move ${
                        draggedIndex === idx
                          ? "border-cyan-400 opacity-60 scale-95"
                          : "border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      {/* Delete Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(idx);
                        }}
                        className="absolute -top-2 -right-2 p-1 bg-rose-600 hover:bg-rose-500 text-white rounded-full shadow-md z-10 transition-colors"
                        title="Remove image"
                      >
                        <X className="w-3 h-3" />
                      </button>

                      <div>
                        {/* Version Badge */}
                        <div className="flex items-center justify-between mb-1.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                              isFirst
                                ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                                : isLast
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : "bg-slate-800 text-slate-300"
                            }`}
                          >
                            Rev {idx + 1} {isFirst ? "(Baseline)" : isLast ? "(Latest)" : ""}
                          </span>
                        </div>

                        {/* Image Thumbnail */}
                        <div className="aspect-[4/3] bg-slate-900 rounded flex items-center justify-center overflow-hidden mb-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={URL.createObjectURL(file)}
                            alt={file.name}
                            className="w-full h-full object-cover rounded pointer-events-none"
                          />
                        </div>

                        <div className="text-[11px] font-mono text-slate-300 truncate" title={file.name}>
                          {file.name}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {(file.size / 1024).toFixed(1)} KB
                        </div>
                      </div>

                      {/* Reorder Buttons */}
                      <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-800/80">
                        <button
                          type="button"
                          disabled={isFirst}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveFile(idx, idx - 1);
                          }}
                          className="p-1 text-slate-400 hover:text-cyan-400 disabled:opacity-20 disabled:hover:text-slate-400"
                          title="Move Earlier"
                        >
                          <MoveLeft className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[10px] font-mono text-slate-500">Order: #{idx + 1}</span>
                        <button
                          type="button"
                          disabled={isLast}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveFile(idx, idx + 1);
                          }}
                          className="p-1 text-slate-400 hover:text-cyan-400 disabled:opacity-20 disabled:hover:text-slate-400"
                          title="Move Later"
                        >
                          <MoveRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Review Opt-In Checkbox */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex items-start gap-3">
            <input
              type="checkbox"
              id="opt-in-review-checkbox"
              checked={optInReview}
              onChange={(e) => setOptInReview(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-slate-700 text-cyan-500 focus:ring-cyan-500/20 bg-slate-900 cursor-pointer"
            />
            <label htmlFor="opt-in-review-checkbox" className="text-xs text-slate-300 leading-relaxed cursor-pointer">
              <span className="font-bold text-white block">
                Review & edit extracted declarations before running compliance & diff analysis
              </span>
              Check this box to inspect the label image and manually adjust extracted declarations (Statutory fields, Ingredients, Allergens, Nutrition table, Marketing claims) prior to final evaluation.
            </label>
          </div>

          {/* Action Button */}
          <div className="flex justify-end">
            <button
              onClick={handleStartAnalysis}
              disabled={loading || selectedFiles.length < 2}
              className="py-3 px-6 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-bold transition-all shadow-lg flex items-center gap-2"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{loadingStep || "Processing Revisions..."}</span>
                </>
              ) : (
                <>
                  <GitCompare className="w-4 h-4" />
                  <span>Analyze Revisions ({selectedFiles.length} Labels)</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STAGE 2: CONDITIONAL HUMAN REVIEW SPLIT-VIEW (With Label Image Preview) */}
      {/* ========================================================================= */}
      {workflowState === "review" && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-400" />
                Phase 3: Multi-Revision Declarations Review (Opted-In)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Verify and edit the extracted statutory and non-statutory sections against the packaging label image.
              </p>
            </div>
            <button
              onClick={() => executeEvaluation(extractedPackages, autoSortByDate)}
              disabled={loading}
              className="py-2.5 px-5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2 shadow"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              <span>Run Comparative Analysis</span>
            </button>
          </div>

          {/* Revision Selector Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-2 border-b border-slate-800/60 font-mono text-xs">
            {extractedPackages.map((pkg, idx) => (
              <button
                key={pkg.package_id}
                onClick={() => setActiveReviewTab(idx)}
                className={`py-2 px-4 rounded-lg font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                  activeReviewTab === idx
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                    : "bg-slate-950 text-slate-400 hover:bg-slate-800 border border-slate-800"
                }`}
              >
                <span>Revision {idx + 1}</span>
                <span className="text-[10px] text-slate-500">
                  {pkg.filename ? `(${pkg.filename})` : `(${pkg.package_id})`}
                </span>
              </button>
            ))}
          </div>

          {/* Side-by-Side Review Grid: Image on Left, Declarations on Right */}
          {extractedPackages[activeReviewTab] && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: High-Res Label Image Preview */}
              <div className="lg:col-span-5 bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col space-y-3 sticky top-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80 text-xs font-mono">
                  <span className="font-bold text-white truncate">
                    Rev {activeReviewTab + 1}: {extractedPackages[activeReviewTab].filename || "Label Preview"}
                  </span>
                  <a
                    href={`${API_BASE_URL}${extractedPackages[activeReviewTab].image_url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-400 hover:text-cyan-300 text-[11px] flex items-center gap-1"
                  >
                    <Maximize2 className="w-3 h-3" /> Full View
                  </a>
                </div>

                <div className="w-full h-[520px] bg-slate-900/60 rounded-lg flex items-center justify-center overflow-hidden border border-slate-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${API_BASE_URL}${extractedPackages[activeReviewTab].image_url}`}
                    alt={`Revision ${activeReviewTab + 1}`}
                    className="max-h-full max-w-full object-contain rounded"
                  />
                </div>
              </div>

              {/* Right Column: Review Declarations (Statutory & Non-Statutory) */}
              <div className="lg:col-span-7 space-y-4">
                {/* Section Selector Tabs */}
                <div className="flex border-b border-slate-800 text-xs font-mono gap-1 overflow-x-auto bg-slate-950 p-1 rounded-lg">
                  <button
                    onClick={() => setReviewSection("statutory")}
                    className={`px-3 py-1.5 rounded transition-colors whitespace-nowrap ${
                      reviewSection === "statutory"
                        ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Statutory LMPC
                  </button>
                  <button
                    onClick={() => setReviewSection("ingredients")}
                    className={`px-3 py-1.5 rounded transition-colors whitespace-nowrap ${
                      reviewSection === "ingredients"
                        ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Ingredients
                  </button>
                  <button
                    onClick={() => setReviewSection("allergens")}
                    className={`px-3 py-1.5 rounded transition-colors whitespace-nowrap ${
                      reviewSection === "allergens"
                        ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Allergens
                  </button>
                  <button
                    onClick={() => setReviewSection("nutrition")}
                    className={`px-3 py-1.5 rounded transition-colors whitespace-nowrap ${
                      reviewSection === "nutrition"
                        ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Nutrition Facts
                  </button>
                  <button
                    onClick={() => setReviewSection("claims")}
                    className={`px-3 py-1.5 rounded transition-colors whitespace-nowrap ${
                      reviewSection === "claims"
                        ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Marketing Claims
                  </button>
                </div>

                {/* Tab Content 1: Statutory LMPC Declarations */}
                {reviewSection === "statutory" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {Object.keys(STATUTORY_FIELD_LABELS).map((fname) => {
                      const fieldObj = extractedPackages[activeReviewTab].fields?.[fname] || {};
                      const currentValue = fieldObj.confirmed_value ?? fieldObj.raw_value ?? "";

                      return (
                        <div key={fname} className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-slate-200">
                              {STATUTORY_FIELD_LABELS[fname]}
                            </label>
                            <span className="text-[10px] font-mono text-slate-500">
                              conf: {((fieldObj.confidence || 0.9) * 100).toFixed(0)}%
                            </span>
                          </div>

                          <input
                            type="text"
                            value={currentValue}
                            onChange={(e) => handleUpdateFieldValue(activeReviewTab, fname, e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Tab Content 2: Ingredients */}
                {reviewSection === "ingredients" && (
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3">
                    <label className="text-xs font-bold text-slate-200 uppercase tracking-wider block">
                      Ingredients Declaration Clause
                    </label>
                    <textarea
                      rows={4}
                      value={extractedPackages[activeReviewTab].extracted_non_statutory?.ingredients_text || ""}
                      onChange={(e) =>
                        handleUpdateNonStatutory(activeReviewTab, "ingredients_text", e.target.value)
                      }
                      placeholder="e.g. Refined Wheat Flour (Maida), Sugar, Edible Vegetable Oil, Mixed Nuts..."
                      className="w-full bg-slate-900 border border-slate-700 rounded p-2.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                    />

                    {extractedPackages[activeReviewTab].extracted_non_statutory?.ingredients_list?.length > 0 && (
                      <div className="pt-2">
                        <span className="text-[11px] font-mono text-slate-400 block mb-1.5">
                          Parsed Ingredients ({extractedPackages[activeReviewTab].extracted_non_statutory.ingredients_list.length} items):
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {extractedPackages[activeReviewTab].extracted_non_statutory.ingredients_list.map((item: string, iIdx: number) => (
                            <span key={iIdx} className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-900 text-slate-300 border border-slate-800">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Tab Content 3: Allergens */}
                {reviewSection === "allergens" && (
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3">
                    <label className="text-xs font-bold text-slate-200 uppercase tracking-wider block">
                      Declared Allergens
                    </label>
                    <input
                      type="text"
                      value={(extractedPackages[activeReviewTab].extracted_non_statutory?.allergens || []).join(", ")}
                      onChange={(e) => {
                        const items = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                        handleUpdateNonStatutory(activeReviewTab, "allergens", items);
                      }}
                      placeholder="Comma-separated allergens (e.g. Wheat, Gluten, Milk, Peanuts)"
                      className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                    />
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {(extractedPackages[activeReviewTab].extracted_non_statutory?.allergens || []).map((a: string, aIdx: number) => (
                        <span key={aIdx} className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20 font-bold">
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tab Content 4: Nutrition Table */}
                {reviewSection === "nutrition" && (
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3">
                    <label className="text-xs font-bold text-slate-200 uppercase tracking-wider block">
                      Nutritional Facts Table (Per 100g)
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {["Energy", "Protein", "Carbohydrate", "Total Sugars", "Total Fat", "Sodium"].map((nut) => {
                        const nutTable = extractedPackages[activeReviewTab].extracted_non_statutory?.nutrition_table || {};
                        const val = nutTable[nut] || "";

                        return (
                          <div key={nut} className="bg-slate-900 border border-slate-800 rounded p-2 space-y-1">
                            <span className="text-[10px] font-mono text-slate-400 block">{nut}</span>
                            <input
                              type="text"
                              value={val}
                              onChange={(e) => {
                                const copy = { ...nutTable, [nut]: e.target.value };
                                handleUpdateNonStatutory(activeReviewTab, "nutrition_table", copy);
                              }}
                              placeholder="e.g. 480 kcal"
                              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-white"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Tab Content 5: Marketing Claims */}
                {reviewSection === "claims" && (
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3">
                    <label className="text-xs font-bold text-slate-200 uppercase tracking-wider block">
                      Marketing Claims & Buzzwords
                    </label>
                    <input
                      type="text"
                      value={(extractedPackages[activeReviewTab].extracted_non_statutory?.marketing_claims || []).join(", ")}
                      onChange={(e) => {
                        const items = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                        handleUpdateNonStatutory(activeReviewTab, "marketing_claims", items);
                      }}
                      placeholder="Comma-separated claims (e.g. 100% Veg, High Fibre, Zero Trans Fat)"
                      className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                )}

                {/* Navigation and Confirmation Buttons */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={activeReviewTab === 0}
                      onClick={() => setActiveReviewTab(activeReviewTab - 1)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white rounded text-xs font-bold transition-colors"
                    >
                      ← Previous
                    </button>
                    <button
                      type="button"
                      disabled={activeReviewTab === extractedPackages.length - 1}
                      onClick={() => setActiveReviewTab(activeReviewTab + 1)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white rounded text-xs font-bold transition-colors"
                    >
                      Next →
                    </button>
                  </div>

                  <button
                    onClick={() => executeEvaluation(extractedPackages, autoSortByDate)}
                    disabled={loading}
                    className="py-2.5 px-6 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg flex items-center gap-2"
                  >
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
                    <span>Confirm & Run Analysis</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* STAGE 3: MULTI-REVISION TIMELINE & EVOLUTION RESULTS */}
      {/* ========================================================================= */}
      {workflowState === "results" && diffResult && (
        <div className="space-y-6">
          {/* Executive Insights Banner */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Pricing, Volume & Shrinkflation Radar */}
            <div
              className={`rounded-xl p-4 border flex flex-col justify-between ${
                diffResult.shrinkflation?.is_shrinkflation || diffResult.packaging_evolution_summary?.has_price_change || diffResult.packaging_evolution_summary?.has_quantity_change
                  ? "bg-rose-950/20 border-rose-500/40"
                  : "bg-slate-900/60 border-slate-800"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4" /> Pricing & Volume Radar
                  </span>
                  {diffResult.shrinkflation?.is_shrinkflation ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      Stealth Shrinkflation
                    </span>
                  ) : diffResult.shrinkflation?.category === "PRICE_HIKE" ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      Price Hike
                    </span>
                  ) : diffResult.shrinkflation?.category === "DOWNSIZED" ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Downsized
                    </span>
                  ) : diffResult.shrinkflation?.category === "PRICE_DROP" ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Price Drop
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-400">
                      Pricing Stable
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-200 font-sans leading-relaxed">
                  {diffResult.shrinkflation?.summary || "Unit pricing and packaging quantity remained constant across revisions."}
                </p>
              </div>

              {diffResult.shrinkflation && (
                <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-1 text-xs font-mono">
                  {diffResult.shrinkflation.old_mrp && diffResult.shrinkflation.new_mrp && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">MRP Drift:</span>
                      <span className="text-slate-200 font-semibold">
                        {diffResult.shrinkflation.old_mrp} → {diffResult.shrinkflation.new_mrp}
                        {diffResult.shrinkflation.mrp_delta_pct !== 0 && (
                          <span className={`ml-1.5 font-bold ${diffResult.shrinkflation.mrp_delta_pct > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                            ({diffResult.shrinkflation.mrp_delta_pct > 0 ? "+" : ""}{diffResult.shrinkflation.mrp_delta_pct}%)
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {diffResult.shrinkflation.old_net_quantity && diffResult.shrinkflation.new_net_quantity && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Net Quantity:</span>
                      <span className="text-slate-200 font-semibold">
                        {diffResult.shrinkflation.old_net_quantity} → {diffResult.shrinkflation.new_net_quantity}
                        {diffResult.shrinkflation.qty_delta_pct !== 0 && (
                          <span className={`ml-1.5 font-bold ${diffResult.shrinkflation.qty_delta_pct > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            ({diffResult.shrinkflation.qty_delta_pct > 0 ? "+" : ""}{diffResult.shrinkflation.qty_delta_pct}%)
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {diffResult.shrinkflation.unit_price_delta_pct !== undefined && (
                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-900">
                      <span className="text-slate-400">Unit Economics:</span>
                      <span className={`font-bold ${diffResult.shrinkflation.unit_price_delta_pct > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                        {diffResult.shrinkflation.unit_price_delta_pct > 0 ? "+" : ""}
                        {diffResult.shrinkflation.unit_price_delta_pct}% {diffResult.shrinkflation.unit}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2. Legal Metrology Compliance Drift */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" /> LMPC Compliance Drift
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      diffResult.compliance_progression?.overall_drift === "IMPROVED"
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : diffResult.compliance_progression?.overall_drift === "REGRESSED"
                        ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {diffResult.compliance_progression?.overall_drift || "COMPLIANT"}
                  </span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {diffResult.compliance_progression?.regressions?.length > 0
                    ? `Alert: ${diffResult.compliance_progression.regressions.length} statutory regression(s) detected in newer revisions.`
                    : diffResult.compliance_progression?.remediations?.length > 0
                    ? `Remediation verified: ${diffResult.compliance_progression.remediations.length} previous violation(s) were resolved.`
                    : "No statutory compliance regressions detected between batch revisions."}
                </p>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>Remediated: {diffResult.compliance_progression?.remediations?.length || 0}</span>
                <span>Regressions: {diffResult.compliance_progression?.regressions?.length || 0}</span>
              </div>
            </div>

            {/* 3. Allergen & Formulation Alert */}
            <div
              className={`rounded-xl p-4 border flex flex-col justify-between ${
                diffResult.allergens_diff?.risk_level === "HIGH"
                  ? "bg-amber-950/20 border-amber-500/40"
                  : "bg-slate-900/60 border-slate-800"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <BadgeAlert className="w-4 h-4" /> Formulation & Allergen Risk
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Risk: {diffResult.allergens_diff?.risk_level || "LOW"}
                  </span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {diffResult.allergens_diff?.risk_explanation || diffResult.ingredients_diff?.notes || "No critical allergen or ingredient substitutions detected."}
                </p>
              </div>
              {diffResult.allergens_diff?.added?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-800/80 text-xs font-mono text-amber-300">
                  New Allergens: {diffResult.allergens_diff.added.join(", ")}
                </div>
              )}
            </div>
          </div>

          {/* Key Packaging Evolution Shifts Banner */}
          {diffResult.packaging_evolution_summary?.key_shifts?.length > 0 && (
            <div className="bg-slate-950 border border-cyan-500/30 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-wider">
                <Sparkles className="w-4 h-4" /> Packaging Evolution & Variance Highlights
              </div>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono text-slate-200">
                {diffResult.packaging_evolution_summary.key_shifts.map((shift: string, sIdx: number) => (
                  <li key={sIdx} className="flex items-start gap-2 bg-slate-900/60 p-2.5 rounded border border-slate-800/80">
                    <ArrowRight className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                    <span>{shift}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Chronological Revision Cards Deck */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Calendar className="w-4 h-4 text-cyan-400" />
              Packaging Evolution Lineage ({diffResult.num_revisions} Revisions)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {diffResult.revisions.map((rev: any, idx: number) => {
                const overallResult = rev.verdict?.overall_result || "PASS";
                const isFail = overallResult === "FAIL";
                const isReview = overallResult === "NEEDS_REVIEW";
                const isFirst = idx === 0;
                const isLast = idx === diffResult.revisions.length - 1;

                const mrpStepDelta = diffResult.statutory_diffs?.find((d: any) => d.field_name === "mrp")?.step_deltas?.[idx];
                const qtyStepDelta = diffResult.statutory_diffs?.find((d: any) => d.field_name === "net_quantity")?.step_deltas?.[idx];
                const mfgStepDelta = diffResult.statutory_diffs?.find((d: any) => d.field_name === "mfg_month_year")?.step_deltas?.[idx];

                return (
                  <div
                    key={rev.package_id}
                    className={`bg-slate-950 rounded-xl p-3 border transition-all flex flex-col justify-between ${
                      isFail
                        ? "border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.1)]"
                        : isReview
                        ? "border-amber-500/50"
                        : "border-emerald-500/30"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold font-mono text-cyan-400">
                          Rev {idx + 1} {isFirst ? "(Base)" : isLast ? "(Latest)" : ""}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                            isFail
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                              : isReview
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                              : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          }`}
                        >
                          {isFail && <AlertOctagon className="w-3 h-3" />}
                          {!isFail && !isReview && <CheckCheck className="w-3 h-3" />}
                          {overallResult}
                        </span>
                      </div>

                      <div className="aspect-[4/3] bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center mb-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`${API_BASE_URL}${rev.image_url}`}
                          alt={`Revision ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </div>

                      <div className="space-y-1 font-mono text-[11px]">
                        <div className="text-slate-400 truncate">
                          <span className="text-slate-600">ID:</span> {rev.package_id}
                        </div>
                        <div className="text-slate-300 flex items-center justify-between">
                          <span><span className="text-slate-600">Mfg:</span> {rev.mfg_date || "(Unknown)"}</span>
                          {mfgStepDelta && mfgStepDelta !== "Unchanged" && (
                            <span className="px-1 py-0.2 rounded text-[9px] bg-cyan-950/80 text-cyan-300 border border-cyan-800">
                              {mfgStepDelta}
                            </span>
                          )}
                        </div>
                        <div className="text-slate-300 flex items-center justify-between">
                          <span className="truncate"><span className="text-slate-600">MRP:</span> {rev.fields?.mrp || "N/A"}</span>
                          {mrpStepDelta && mrpStepDelta !== "Unchanged" && (
                            <span className={`px-1 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                              mrpStepDelta.includes("+")
                                ? "bg-rose-950 text-rose-300 border border-rose-800"
                                : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                            }`}>
                              {mrpStepDelta}
                            </span>
                          )}
                        </div>
                        <div className="text-slate-300 flex items-center justify-between">
                          <span className="truncate"><span className="text-slate-600">Qty:</span> {rev.fields?.net_quantity || "N/A"}</span>
                          {qtyStepDelta && qtyStepDelta !== "Unchanged" && (
                            <span className={`px-1 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                              qtyStepDelta.includes("-")
                                ? "bg-rose-950 text-rose-300 border border-rose-800"
                                : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                            }`}>
                              {qtyStepDelta}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {rev.barcodes?.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-slate-900 text-[10px] font-mono text-slate-500 truncate">
                        Barcode: {rev.barcodes[0]}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Granular Comparative Matrix Tabs */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex border-b border-slate-800 font-mono text-xs overflow-x-auto bg-slate-950">
              <button
                onClick={() => setActiveDiffTab("variance")}
                className={`py-3 px-5 font-bold transition-colors whitespace-nowrap flex items-center gap-2 ${
                  activeDiffTab === "variance"
                    ? "text-cyan-400 border-b-2 border-cyan-400 bg-slate-900"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                <span>Packaging Variance & Evolution</span>
              </button>

              <button
                onClick={() => setActiveDiffTab("lmpc")}
                className={`py-3 px-5 font-bold transition-colors whitespace-nowrap flex items-center gap-2 ${
                  activeDiffTab === "lmpc"
                    ? "text-cyan-400 border-b-2 border-cyan-400 bg-slate-900"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Statutory LMPC Rules Compliance</span>
              </button>

              <button
                onClick={() => setActiveDiffTab("ingredients")}
                className={`py-3 px-5 font-bold transition-colors whitespace-nowrap flex items-center gap-2 ${
                  activeDiffTab === "ingredients"
                    ? "text-cyan-400 border-b-2 border-cyan-400 bg-slate-900"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <ListOrdered className="w-4 h-4" />
                <span>Ingredients Formulation & Extraction</span>
              </button>

              <button
                onClick={() => setActiveDiffTab("allergens")}
                className={`py-3 px-5 font-bold transition-colors whitespace-nowrap flex items-center gap-2 ${
                  activeDiffTab === "allergens"
                    ? "text-cyan-400 border-b-2 border-cyan-400 bg-slate-900"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <BadgeAlert className="w-4 h-4" />
                <span>Allergen Advisories</span>
              </button>

              <button
                onClick={() => setActiveDiffTab("nutrition")}
                className={`py-3 px-5 font-bold transition-colors whitespace-nowrap flex items-center gap-2 ${
                  activeDiffTab === "nutrition"
                    ? "text-cyan-400 border-b-2 border-cyan-400 bg-slate-900"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Info className="w-4 h-4" />
                <span>Nutrition Facts & Marketing Claims</span>
              </button>
            </div>

            {/* =============================================================== */}
            {/* TAB 1: Packaging Variance & Declarations Evolution */}
            {/* =============================================================== */}
            {activeDiffTab === "variance" && (
              <div className="p-5 space-y-6">
                {/* Part 1: Packaging Variance & Declarations Evolution Tracker */}
                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-cyan-400" />
                      Packaging Variance & Declarations Evolution
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Tracks price inflation, volume downsizing (shrinkflation), timeline advancement, and identity shifts across packaging revisions.
                    </p>
                  </div>

                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                    {diffResult.statutory_diffs.map((diff: any) => {
                      const isPriceHike = diff.change_type === "INCREASE" && diff.field_name === "mrp";
                      const isPriceDrop = diff.change_type === "DECREASE" && diff.field_name === "mrp";
                      const isDownsized = diff.change_type === "DOWNSIZED" || (diff.change_type === "DECREASE" && diff.field_name === "net_quantity");
                      const isQtyGain = diff.change_type === "INCREASE" && diff.field_name === "net_quantity";
                      const isDateAdvanced = diff.change_type === "ADVANCED";
                      const isChanged = diff.changed;

                      return (
                        <div key={diff.field_name} className="p-4 space-y-3">
                          {/* Declaration Header & Dynamic Evolution Badge */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <span className="font-mono text-xs font-bold text-white uppercase">
                              {STATUTORY_FIELD_LABELS[diff.field_name] || diff.field_name}
                            </span>

                            {/* Evolution Status Badge */}
                            <div>
                              {isPriceHike ? (
                                <span className="px-2.5 py-0.5 rounded text-[11px] font-bold font-mono bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1.5 shadow-[0_0_10px_rgba(244,63,94,0.15)]">
                                  <TrendingUp className="w-3.5 h-3.5" />
                                  <span>PRICE HIKE: {diff.delta_badge}</span>
                                </span>
                              ) : isPriceDrop ? (
                                <span className="px-2.5 py-0.5 rounded text-[11px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5">
                                  <TrendingDown className="w-3.5 h-3.5" />
                                  <span>PRICE REDUCED: {diff.delta_badge}</span>
                                </span>
                              ) : isDownsized ? (
                                <span className="px-2.5 py-0.5 rounded text-[11px] font-bold font-mono bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1.5 shadow-[0_0_10px_rgba(244,63,94,0.15)]">
                                  <TrendingDown className="w-3.5 h-3.5" />
                                  <span>DOWNSIZED: {diff.delta_badge}</span>
                                </span>
                              ) : isQtyGain ? (
                                <span className="px-2.5 py-0.5 rounded text-[11px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5">
                                  <TrendingUp className="w-3.5 h-3.5" />
                                  <span>VOLUME INCREASE: {diff.delta_badge}</span>
                                </span>
                              ) : isDateAdvanced ? (
                                <span className="px-2.5 py-0.5 rounded text-[11px] font-bold font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 flex items-center gap-1.5">
                                  <Calendar className="w-3.5 h-3.5" />
                                  <span>TIMELINE ADVANCED: {diff.delta_badge}</span>
                                </span>
                              ) : isChanged ? (
                                <span className="px-2.5 py-0.5 rounded text-[11px] font-bold font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  <span>{diff.delta_badge || "Declaration Altered"}</span>
                                </span>
                              ) : (
                                <span className="px-2.5 py-0.5 rounded text-[10px] font-semibold font-mono bg-slate-800/80 text-slate-400 flex items-center gap-1 border border-slate-700/50">
                                  <CheckCheck className="w-3 h-3 text-emerald-400" />
                                  <span>Identical Across Revisions</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Human-Readable Evolution Narrative */}
                          {diff.summary && (
                            <p className="text-xs text-slate-300 font-sans leading-relaxed bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/70">
                              {diff.summary}
                            </p>
                          )}

                          {/* Side-by-Side Progression Cards */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-1">
                            {diff.values.map((val: string, rIdx: number) => {
                              const stepDelta = diff.step_deltas?.[rIdx];
                              const hasStepShift = stepDelta && stepDelta !== "Unchanged";

                              return (
                                <div
                                  key={rIdx}
                                  className={`p-2.5 rounded-lg border text-xs font-mono space-y-1.5 ${
                                    hasStepShift
                                      ? "bg-slate-900 border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.08)]"
                                      : "bg-slate-900/40 border-slate-800/80 text-slate-300"
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-400 font-bold">
                                      Revision {rIdx + 1} {rIdx === 0 ? "(Base)" : rIdx === diff.values.length - 1 ? "(Latest)" : ""}
                                    </span>
                                    {hasStepShift && (
                                      <span
                                        className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                          stepDelta.includes("+") && diff.field_name === "mrp"
                                            ? "bg-rose-950 text-rose-300 border border-rose-800"
                                            : stepDelta.includes("-")
                                            ? "bg-rose-950 text-rose-300 border border-rose-800"
                                            : "bg-cyan-950 text-cyan-300 border border-cyan-800"
                                        }`}
                                      >
                                        {stepDelta}
                                      </span>
                                    )}
                                  </div>
                                  <div className="font-semibold text-slate-100 break-words">
                                    {val || <span className="text-slate-500 italic">(Not Declared)</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* =============================================================== */}
            {/* TAB 2: Statutory LMPC Rules Compliance Audit Matrix */}
            {/* =============================================================== */}
            {activeDiffTab === "lmpc" && (
              <div className="p-5 space-y-6">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      Legal Metrology (LMPC) Statutory Rules Audit Matrix
                    </h4>
                    <p className="text-xs text-slate-400">
                      Evaluates whether declarations strictly meet Legal Metrology formatting requirements (e.g. standard units, MRP tax inclusive wording, consumer redressal details) on each revision.
                    </p>
                  </div>

                  {/* Granular Rules Matrix */}
                  {diffResult.lmpc_rules_matrix?.length > 0 ? (
                    <div className="border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800/80 bg-slate-950">
                      {diffResult.lmpc_rules_matrix.map((ruleRow: any) => {
                        const isExpanded = expandedRules[ruleRow.rule_id];

                        return (
                          <div key={ruleRow.rule_id} className="p-4 space-y-3">
                            <div
                              onClick={() => toggleRuleExpand(ruleRow.rule_id)}
                              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer group"
                            >
                              <div className="flex items-start gap-2.5">
                                <span className="p-1 rounded bg-slate-900 text-slate-400 group-hover:text-cyan-400 transition-colors mt-0.5">
                                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                </span>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs font-bold text-cyan-300">
                                      {ruleRow.rule_id}
                                    </span>
                                    <span className="text-xs font-semibold text-slate-200">
                                      {ruleRow.description}
                                    </span>
                                  </div>
                                  <span className="text-[11px] font-mono text-slate-500 block mt-0.5">
                                    {ruleRow.citation}
                                  </span>
                                </div>
                              </div>

                              {/* Drift Badge */}
                              <div className="self-end sm:self-center">
                                <span
                                  className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-mono ${
                                    ruleRow.drift === "REMEDIATED"
                                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                      : ruleRow.drift === "REGRESSED"
                                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                      : ruleRow.drift === "PERSISTENT_FAIL"
                                      ? "bg-rose-950/40 text-rose-400 border border-rose-900"
                                      : "bg-slate-900 text-slate-400 border border-slate-800"
                                  }`}
                                >
                                  {ruleRow.drift.replace("_", " ")}
                                </span>
                              </div>
                            </div>

                            {/* Evaluation Cards Per Revision */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-1">
                              {ruleRow.evaluations.map((ev: any, evIdx: number) => {
                                const isRegression = ev.status_category === "REGRESSION" || ev.display_result === "REGRESSED";
                                const isRemediation = ev.status_category === "REMEDIATION" || ev.display_result === "REMEDIATED";
                                const isPersistentFail = ev.status_category === "PERSISTENT_FAIL";
                                const isPass = (ev.result === "PASS" || ev.display_result === "PASS") && !isRegression;

                                return (
                                  <div
                                    key={evIdx}
                                    className={`rounded-lg p-2.5 border text-xs font-mono space-y-1.5 ${
                                      isRegression
                                        ? "bg-rose-950/40 border-rose-500/80 shadow-[0_0_12px_rgba(244,63,94,0.2)]"
                                        : isRemediation
                                        ? "bg-emerald-950/30 border-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                                        : isPass
                                        ? "bg-emerald-950/10 border-emerald-500/20"
                                        : isPersistentFail
                                        ? "bg-rose-950/25 border-rose-700/40"
                                        : "bg-slate-900/40 border-slate-800"
                                    }`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] text-slate-400 font-bold">
                                        Revision {ev.revision_index + 1}
                                      </span>
                                      <span
                                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 ${
                                          isRegression
                                            ? "bg-rose-500/30 text-rose-200 border border-rose-500"
                                            : isRemediation
                                            ? "bg-emerald-500/30 text-emerald-200 border border-emerald-500"
                                            : isPass
                                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                            : isPersistentFail
                                            ? "bg-rose-950/50 text-rose-300 border border-rose-800/60"
                                            : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                        }`}
                                      >
                                        {isRegression ? (
                                          <>
                                            <TrendingDown className="w-2.5 h-2.5" />
                                            <span>REGRESSED</span>
                                          </>
                                        ) : isRemediation ? (
                                          <>
                                            <Sparkles className="w-2.5 h-2.5" />
                                            <span>REMEDIATED</span>
                                          </>
                                        ) : isPersistentFail ? (
                                          <span>PERSISTENT FAIL</span>
                                        ) : (
                                          <span>{ev.result}</span>
                                        )}
                                      </span>
                                    </div>

                                    {/* Condition & Explanation Note */}
                                    <p className="text-[11px] font-sans text-slate-300 leading-snug">
                                      {isRegression
                                        ? `Regression Alert: This rule previously passed in an earlier revision but is now violated here. Reason: ${ev.notes}`
                                        : isRemediation
                                        ? `Remediation Success: Previously failing violation was resolved in this revision. ${ev.notes}`
                                        : ev.notes}
                                    </p>

                                    {ev.extracted_value && (
                                      <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800/60 truncate">
                                        <span className="text-slate-500">Val:</span> {ev.extracted_value}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No rule evaluations available.</p>
                  )}
                </div>
              </div>
            )}

            {/* =============================================================== */}
            {/* TAB 2: Ingredients Formulation & Side-by-Side Extraction */}
            {/* =============================================================== */}
            {activeDiffTab === "ingredients" && (
              <div className="p-5 space-y-6">
                {/* Formulation Summary */}
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2">
                    Recipe Formulation Analysis
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {diffResult.ingredients_diff?.notes || "No formulation shifts detected across revisions."}
                  </p>
                </div>

                {/* Detected Substitutions */}
                {diffResult.ingredients_diff?.substitutions?.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" /> Detected Recipe Substitutions
                    </h4>
                    <div className="space-y-2">
                      {diffResult.ingredients_diff.substitutions.map((sub: any, sIdx: number) => (
                        <div
                          key={sIdx}
                          className="bg-slate-950 border border-amber-500/30 rounded-lg p-3 text-xs flex items-center justify-between gap-4 font-mono"
                        >
                          <span className="text-rose-400 line-through">{sub.old_ingredient}</span>
                          <ArrowRight className="w-4 h-4 text-slate-500" />
                          <span className="text-emerald-400 font-bold">{sub.new_ingredient}</span>
                          <span className="text-slate-400 text-[11px] font-sans">({sub.detail})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Detected Percentage Changes & Ratio Shifts */}
                {diffResult.ingredients_diff?.percentage_changes?.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                      <TrendingDown className="w-4 h-4" /> Recipe Percentage & Ratio Adjustments
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {diffResult.ingredients_diff.percentage_changes.map((pc: any, pIdx: number) => (
                        <div
                          key={pIdx}
                          className="bg-slate-950 border border-cyan-500/30 rounded-lg p-3 text-xs flex flex-col gap-1.5 font-mono"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-white font-bold">{pc.ingredient}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                              {pc.change}
                            </span>
                          </div>
                          {pc.detail && (
                            <span className="text-slate-400 text-[11px] font-sans">
                              {pc.detail}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Side-by-Side Extracted Ingredients Columns */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    Side-by-Side Extracted Ingredients Declarations
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {diffResult.revisions.map((rev: any, rIdx: number) => {
                      const nonStat = rev.extracted_non_statutory || {};
                      const ingList = nonStat.ingredients_list || [];
                      const ingText = nonStat.ingredients_text || "";

                      return (
                        <div
                          key={rev.package_id}
                          className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-3 flex flex-col justify-between"
                        >
                          <div>
                            <span className="font-mono text-xs font-bold text-cyan-400 block border-b border-slate-800 pb-1.5 mb-2">
                              Revision {rIdx + 1} Ingredients
                            </span>

                            {ingList.length > 0 ? (
                              <ul className="space-y-1.5">
                                {ingList.map((item: string, iIdx: number) => {
                                  const isAdded = diffResult.ingredients_diff?.added?.some(
                                    (a: string) => a.toLowerCase() === item.toLowerCase()
                                  );

                                  return (
                                    <li
                                      key={iIdx}
                                      className={`text-xs font-mono p-1.5 rounded border ${
                                        isAdded
                                          ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-300 font-bold"
                                          : "bg-slate-900/60 border-slate-800 text-slate-300"
                                      }`}
                                    >
                                      {isAdded && <span className="text-emerald-400 mr-1">+</span>}
                                      {item}
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <p className="text-xs text-slate-500 italic">No ingredients extracted.</p>
                            )}
                          </div>

                          {ingText && (
                            <div className="pt-2 border-t border-slate-800/80">
                              <span className="text-[10px] text-slate-500 uppercase font-mono block mb-1">
                                Full Text:
                              </span>
                              <p className="text-[10px] text-slate-400 font-mono line-clamp-4" title={ingText}>
                                {ingText}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Additions & Drops Summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
                    <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                      Ingredients Added in Newer Batches
                    </h4>
                    {diffResult.ingredients_diff?.added?.length > 0 ? (
                      <ul className="space-y-1.5 text-xs font-mono text-slate-200">
                        {diffResult.ingredients_diff.added.map((item: string, iIdx: number) => (
                          <li key={iIdx} className="flex items-center gap-2">
                            <span className="text-emerald-400 font-bold">+</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">No new ingredients added.</p>
                    )}
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
                    <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider">
                      Ingredients Removed in Newer Batches
                    </h4>
                    {diffResult.ingredients_diff?.removed?.length > 0 ? (
                      <ul className="space-y-1.5 text-xs font-mono text-slate-200">
                        {diffResult.ingredients_diff.removed.map((item: string, iIdx: number) => (
                          <li key={iIdx} className="flex items-center gap-2">
                            <span className="text-rose-400 font-bold">-</span>
                            <span className="line-through text-slate-400">{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">No ingredients removed.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* =============================================================== */}
            {/* TAB 3: Allergen Advisories */}
            {/* =============================================================== */}
            {activeDiffTab === "allergens" && (
              <div className="p-5 space-y-6">
                <div
                  className={`rounded-lg p-4 border ${
                    diffResult.allergens_diff?.risk_level === "HIGH"
                      ? "bg-rose-950/20 border-rose-500/40"
                      : "bg-slate-950 border-slate-800"
                  }`}
                >
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                    <BadgeAlert className="w-4 h-4 text-amber-400" />
                    Allergen Risk Assessment: {diffResult.allergens_diff?.risk_level || "LOW"}
                  </h4>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    {diffResult.allergens_diff?.risk_explanation || "No new allergen risks identified across packaging revisions."}
                  </p>
                </div>

                {/* Side-by-Side Extracted Allergens */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Declared Allergens Side-by-Side
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {diffResult.revisions.map((rev: any, rIdx: number) => {
                      const nonStat = rev.extracted_non_statutory || {};
                      const allergens = nonStat.allergens || [];

                      return (
                        <div key={rev.package_id} className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-2">
                          <span className="font-mono text-xs font-bold text-cyan-400 block border-b border-slate-800 pb-1.5 mb-2">
                            Rev {rIdx + 1} Allergens
                          </span>
                          {allergens.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {allergens.map((a: string, aIdx: number) => {
                                const isNew = diffResult.allergens_diff?.added?.some(
                                  (item: string) => item.toLowerCase() === a.toLowerCase()
                                );

                                return (
                                  <span
                                    key={aIdx}
                                    className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                                      isNew
                                        ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                        : "bg-slate-900 text-slate-300 border border-slate-800"
                                    }`}
                                  >
                                    {isNew ? `+ ${a}` : a}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 italic">No allergens declared.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Allergen Delta Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
                    <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider">
                      Newly Declared Allergens
                    </h4>
                    {diffResult.allergens_diff?.added?.length > 0 ? (
                      <ul className="space-y-1.5 text-xs font-mono text-rose-300 font-bold">
                        {diffResult.allergens_diff.added.map((item: string, aIdx: number) => (
                          <li key={aIdx} className="flex items-center gap-2">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">No new allergens declared.</p>
                    )}
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Dropped Allergens
                    </h4>
                    {diffResult.allergens_diff?.removed?.length > 0 ? (
                      <ul className="space-y-1.5 text-xs font-mono text-slate-300">
                        {diffResult.allergens_diff.removed.map((item: string, aIdx: number) => (
                          <li key={aIdx} className="flex items-center gap-2">
                            <span>-</span>
                            <span className="line-through text-slate-400">{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">No allergens dropped.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* =============================================================== */}
            {/* TAB 4: Nutrition Facts & Marketing Claims */}
            {/* =============================================================== */}
            {activeDiffTab === "nutrition" && (
              <div className="p-5 space-y-6">
                {/* Nutritional Shifts Banner */}
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Nutritional Facts Shifts
                  </h4>
                  {diffResult.nutritional_diff?.significant_changes?.length > 0 ? (
                    <ul className="space-y-1.5 text-xs font-mono text-slate-200">
                      {diffResult.nutritional_diff.significant_changes.map((change: string, nIdx: number) => (
                        <li key={nIdx} className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                          <span>{change}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-500">No significant nutritional shifts detected.</p>
                  )}
                </div>

                {/* Side-by-Side Nutritional Facts Table */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Nutritional Values Matrix (Per 100g)
                  </h4>

                  <div className="overflow-x-auto border border-slate-800 rounded-lg bg-slate-950">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                        <tr>
                          <th className="p-3">Nutrient</th>
                          {diffResult.revisions.map((_: any, idx: number) => (
                            <th key={idx} className="p-3">Rev {idx + 1}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {["Energy", "Protein", "Carbohydrate", "Total Sugars", "Total Fat", "Sodium"].map((nutrient) => (
                          <tr key={nutrient} className="hover:bg-slate-900/40">
                            <td className="p-3 font-semibold text-slate-300">{nutrient}</td>
                            {diffResult.revisions.map((rev: any, rIdx: number) => {
                              const nutTable = rev.extracted_non_statutory?.nutrition_table || {};
                              const val = nutTable[nutrient] || "—";

                              return (
                                <td key={rIdx} className="p-3 text-slate-200">
                                  {val}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Marketing Claims Side-by-Side */}
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                    Marketing Claims & Buzzwords Side-by-Side
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {diffResult.revisions.map((rev: any, rIdx: number) => {
                      const claims = rev.extracted_non_statutory?.marketing_claims || [];

                      return (
                        <div key={rev.package_id} className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-2">
                          <span className="font-mono text-xs font-bold text-cyan-400 block border-b border-slate-800 pb-1.5 mb-2">
                            Rev {rIdx + 1} Claims
                          </span>
                          {claims.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {claims.map((claim: string, cIdx: number) => (
                                <span key={cIdx} className="px-2 py-0.5 rounded text-[11px] font-mono bg-cyan-950/40 text-cyan-300 border border-cyan-800/40">
                                  {claim}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 italic">No claims declared.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
