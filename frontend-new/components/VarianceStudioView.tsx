"use client";

import React, { useState, useEffect } from "react";
import {
  batchExtractLabels,
  batchEvaluateLabels,
  listPackages,
  compareLabels,
  API_BASE_URL,
} from "@/lib/api";
import { computeWordDiff } from "@/lib/diff";
import { ReportModal } from "./ReportModal";

const STATUTORY_FIELD_LABELS: Record<string, string> = {
  common_name: "Commodity Name",
  mrp: "MRP (Maximum Retail Price)",
  net_quantity: "Net Quantity",
  mfg_month_year: "Month & Year of Mfg/Packing",
  manufacturer_name_address: "Manufacturer Name & Address",
  consumer_care: "Consumer Care Details",
};

const RULE_SHORT_LABELS: Record<string, string> = {
  "LMPC-6.1.a": "Manufacturer Name & Address",
  "LMPC-6.1.b": "Commodity Name",
  "LMPC-6.1.c": "Net Quantity",
  "LMPC-6.1.c-tolerance": "Net Quantity Tolerance",
  "LMPC-6.1.d": "Month & Year of Mfg/Packing",
  "LMPC-6.1.e": "Maximum Retail Price (MRP)",
  "LMPC-6.1.f": "Country of Origin",
  "LMPC-6.2": "Consumer Care Details",
  "LMPC-6.3": "Numeral Size & Display Area",
};

const STANDARD_NUTRIENTS = [
  "Energy",
  "Protein",
  "Carbohydrate",
  "Total Sugars",
  "Added Sugars",
  "Total Fat",
  "Saturated Fat",
  "Trans Fat",
  "Sodium",
  "Cholesterol",
];

// Helper to parse numeric values and units from nutrition strings
function parseNutrientNum(val: string): { num: number; unit: string } | null {
  if (!val || val === "—") return null;
  const m = val.match(/([\d.]+)\s*([a-zA-Z%]*)/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (isNaN(num)) return null;
  return { num, unit: m[2] || "" };
}

// Helper to detect synonymous/renamed ingredients across revisions
interface SynonymousIngredientPair {
  nameA: string;
  nameB: string;
  relationship: string;
}

function detectSynonymousIngredients(
  revisions: any[],
  substitutions: any[] = []
): SynonymousIngredientPair[] {
  const pairs: SynonymousIngredientPair[] = [];
  const seenKeys = new Set<string>();

  const knownEquivalents: Array<[string, string, string]> = [
    ["refined wheat flour (maida)", "maida", "Refined Wheat Flour (Maida) ↔ Maida"],
    ["refined wheat flour", "maida", "Refined Wheat Flour ↔ Maida"],
    ["whole wheat flour (atta)", "atta", "Whole Wheat Flour (Atta) ↔ Atta"],
    ["whole wheat flour", "atta", "Whole Wheat Flour ↔ Atta"],
    ["edible vegetable oil (sunflower oil)", "sunflower oil", "Edible Vegetable Oil (Sunflower Oil) ↔ Sunflower Oil"],
    ["edible vegetable oil (palm oil)", "palm oil", "Edible Vegetable Oil (Palm Oil) ↔ Palm Oil"],
    ["refined palm oil", "palm oil", "Refined Palm Oil ↔ Palm Oil"],
    ["edible vegetable oil (palmolein)", "palmolein", "Edible Vegetable Oil (Palmolein) ↔ Palmolein"],
    ["iodised salt", "salt", "Iodised Salt ↔ Salt"],
    ["refined sugar", "sugar", "Refined Sugar ↔ Sugar"],
    ["milk solids", "dairy solids", "Milk Solids ↔ Dairy Solids"],
  ];

  const revLists = revisions.map(
    (r) => r.extracted_non_statutory?.ingredients_list || []
  );

  for (let i = 0; i < revLists.length; i++) {
    for (let j = i + 1; j < revLists.length; j++) {
      const listA = revLists[i];
      const listB = revLists[j];

      for (const a of listA) {
        for (const b of listB) {
          const normA = a.toLowerCase().trim();
          const normB = b.toLowerCase().trim();
          if (normA === normB) continue;

          for (const [eq1, eq2, label] of knownEquivalents) {
            if (
              (normA.includes(eq1) && normB.includes(eq2)) ||
              (normA.includes(eq2) && normB.includes(eq1))
            ) {
              const key = [a, b].sort().join(":::");
              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                pairs.push({
                  nameA: a,
                  nameB: b,
                  relationship: label,
                });
              }
            }
          }

          const parenMatchA = normA.match(/\(([^)]+)\)/);
          if (parenMatchA && parenMatchA[1].trim().length > 2 && normB.includes(parenMatchA[1].trim())) {
            const key = [a, b].sort().join(":::");
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              pairs.push({
                nameA: a,
                nameB: b,
                relationship: `${a} ↔ ${b} (Parenthetical Name Equivalence)`,
              });
            }
          }
          const parenMatchB = normB.match(/\(([^)]+)\)/);
          if (parenMatchB && parenMatchB[1].trim().length > 2 && normA.includes(parenMatchB[1].trim())) {
            const key = [a, b].sort().join(":::");
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              pairs.push({
                nameA: a,
                nameB: b,
                relationship: `${a} ↔ ${b} (Parenthetical Name Equivalence)`,
              });
            }
          }
        }
      }
    }
  }

  for (const s of substitutions) {
    const oldNorm = (s.old_ingredient || "").toLowerCase();
    const newNorm = (s.new_ingredient || "").toLowerCase();
    const detailNorm = (s.detail || "").toLowerCase();
    const isSyn =
      detailNorm.includes("same") ||
      detailNorm.includes("synonym") ||
      detailNorm.includes("equivalent") ||
      detailNorm.includes("renamed") ||
      detailNorm.includes("wording");

    const key = [s.old_ingredient, s.new_ingredient].sort().join(":::");
    if (!seenKeys.has(key) && (isSyn || oldNorm.includes(newNorm) || newNorm.includes(oldNorm))) {
      seenKeys.add(key);
      pairs.push({
        nameA: s.old_ingredient,
        nameB: s.new_ingredient,
        relationship: s.detail || `${s.old_ingredient} ↔ ${s.new_ingredient} (Wording Variation)`,
      });
    }
  }

  return pairs;
}

export const VarianceStudioView: React.FC = () => {
  // Mode: "batch_upload" (default, 2-5 files) or "existing_db" (pair from database)
  const [activeMode, setActiveMode] = useState<"batch_upload" | "existing_db">("batch_upload");

  // ---------------------------------------------------------------------------
  // Stage 1: Batch Upload State & Reordering (2-5 Files)
  // ---------------------------------------------------------------------------
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [optInReview, setOptInReview] = useState<boolean>(false);
  const [autoSortByDate, setAutoSortByDate] = useState<boolean>(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [loadingStep, setLoadingStep] = useState<string>("");

  // Workflow State for Batch Flow: "upload" | "review" | "results"
  const [workflowState, setWorkflowState] = useState<"upload" | "review" | "results">("upload");

  // ---------------------------------------------------------------------------
  // Stage 2: Extracted Declarations & Review State
  // ---------------------------------------------------------------------------
  const [extractedPackages, setExtractedPackages] = useState<any[]>([]);
  const [activeReviewTab, setActiveReviewTab] = useState<number>(0);
  const [reviewSection, setReviewSection] = useState<"statutory" | "ingredients" | "allergens" | "nutrition" | "claims">("statutory");

  // ---------------------------------------------------------------------------
  // Stage 3: Multi-Revision Diff Results State
  // ---------------------------------------------------------------------------
  const [diffResult, setDiffResult] = useState<any | null>(null);

  // ---------------------------------------------------------------------------
  // Bounding Box State
  // ---------------------------------------------------------------------------
  const [imageSizes, setImageSizes] = useState<Record<number, { width: number; height: number }>>({});
  const [hoveredField, setHoveredField] = useState<string | null>(null);
  const [activeDiffTab, setActiveDiffTab] = useState<"variance" | "lmpc" | "ingredients" | "allergens" | "nutrition">("variance");
  const [expandedRules, setExpandedRules] = useState<Record<string, boolean>>({});
  const [activePhotoPopover, setActivePhotoPopover] = useState<{ revIndex: number; fieldName: string } | null>(null);
  const [photoNaturalSizes, setPhotoNaturalSizes] = useState<Record<number, { width: number; height: number }>>({});
  const [expandedChipKey, setExpandedChipKey] = useState<string | null>(null);
  const [expandedStatutoryField, setExpandedStatutoryField] = useState<string | null>(null);
  const [ruleMatrixFilter, setRuleMatrixFilter] = useState<"all" | "changed" | "unchanged">("all");
  const [focusedBoxField, setFocusedBoxField] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Image Lightbox Modal State
  // ---------------------------------------------------------------------------
  const [lightboxRevisionIndex, setLightboxRevisionIndex] = useState<number | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState<number>(1);
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // Database Pair Mode State
  // ---------------------------------------------------------------------------
  const [dbPackages, setDbPackages] = useState<Array<{ package_id: string; created_at: string }>>([]);
  const [selectedA, setSelectedA] = useState<string>("");
  const [selectedB, setSelectedB] = useState<string>("");
  const [dbPairResult, setDbPairResult] = useState<any | null>(null);
  const [dbPairLoading, setDbPairLoading] = useState<boolean>(false);
  const [dbPairError, setDbPairError] = useState<string | null>(null);

  useEffect(() => {
    if (activeMode === "existing_db" && dbPackages.length === 0) {
      listPackages()
        .then((pkgs) => {
          if (Array.isArray(pkgs)) {
            setDbPackages(pkgs);
            if (pkgs.length >= 2) {
              setSelectedA(pkgs[0].package_id);
              setSelectedB(pkgs[1].package_id);
            }
          }
        })
        .catch(console.error);
    }
  }, [activeMode, dbPackages.length]);

  // Keyboard handler for lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxRevisionIndex === null) return;
      if (e.key === "Escape") {
        setLightboxRevisionIndex(null);
      } else if (e.key === "ArrowLeft" && diffResult?.revisions) {
        setLightboxRevisionIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
        setLightboxZoom(1);
      } else if (e.key === "ArrowRight" && diffResult?.revisions) {
        setLightboxRevisionIndex((prev) =>
          prev !== null && prev < diffResult.revisions.length - 1 ? prev + 1 : prev
        );
        setLightboxZoom(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxRevisionIndex, diffResult?.revisions]);

  // Auto-scroll to top when transitioning workflow state (e.g. entering review or results)
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const timer = setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      document.getElementById("declarations-review-container")?.scrollIntoView({ behavior: "instant", block: "start" });
      document.getElementById("variance-results-container")?.scrollIntoView({ behavior: "instant", block: "start" });
    }, 50);
    return () => clearTimeout(timer);
  }, [workflowState]);

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
    setLoadingStep("Running RapidOCR perception across all revisions...");

    try {
      const extractRes = await batchExtractLabels(selectedFiles);
      setExtractedPackages(extractRes.packages);

      if (optInReview) {
        setWorkflowState("review");
        setActiveReviewTab(0);
        setLoading(false);
      } else {
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

      const res = await batchEvaluateLabels(payload, sortDate);
      setDiffResult(res);
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
        updated[pkgIndex].fields[fieldName] = {
          field_name: fieldName,
          raw_value: value,
          confirmed_value: value,
          confidence: 1.0,
        };
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
        const parts = value
          .split(/[,;]\s*(?![^()]*\))/)
          .map((s: string) => s.trim())
          .filter(Boolean);
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
    setLightboxRevisionIndex(null);
  };

  const toggleRuleExpand = (ruleId: string) => {
    setExpandedRules((prev) => ({ ...prev, [ruleId]: !prev[ruleId] }));
  };

  // Helper for image URLs
  const getFullImageUrl = (rawUrl: string | undefined): string => {
    if (!rawUrl) return "";
    if (rawUrl.startsWith("http")) return rawUrl;
    return `${API_BASE_URL}${rawUrl}`;
  };

  // ---------------------------------------------------------------------------
  // Database Pair Comparison
  // ---------------------------------------------------------------------------
  const handleRunDbPairDiff = async () => {
    if (!selectedA || !selectedB || selectedA === selectedB) {
      setDbPairError("Please select two distinct packages to compare.");
      return;
    }
    setDbPairLoading(true);
    setDbPairError(null);
    setDbPairResult(null);
    try {
      const data = await compareLabels(selectedA, selectedB);
      setDbPairResult(data);
    } catch (err: any) {
      setDbPairError(err.message || "Failed to compare packages");
    } finally {
      setDbPairLoading(false);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-[1600px] mx-auto pb-4 animate-fadeIn">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-hairline">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-seal text-[22px]">compare</span>
            <h1 className="text-xl sm:text-2xl font-heading font-semibold text-ink tracking-tight">
              Packaging Variance &amp; Evolution Inspector
            </h1>
          </div>
          <p className="text-xs text-ink-light max-w-2xl leading-relaxed">
            Audit Legal Metrology (LMPC) statutory compliance, shrinkflation, ingredient formulation shifts, and allergen risks across 2 to 5 packaging revisions.
          </p>
        </div>

        {/* Top actions: Mode toggle & Reset */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {workflowState === "upload" && (
            <div className="flex items-center p-1 bg-wash rounded-md border border-hairline text-xs font-mono">
              <button
                type="button"
                onClick={() => setActiveMode("batch_upload")}
                className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                  activeMode === "batch_upload"
                    ? "bg-seal text-white font-medium shadow-sm"
                    : "text-ink-light hover:text-ink"
                }`}
              >
                Upload 2–5 Images
              </button>
              <button
                type="button"
                onClick={() => setActiveMode("existing_db")}
                className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                  activeMode === "existing_db"
                    ? "bg-seal text-white font-medium shadow-sm"
                    : "text-ink-light hover:text-ink"
                }`}
              >
                Compare Database Records
              </button>
            </div>
          )}

          {workflowState !== "upload" && (
            <button
              onClick={handleReset}
              className="px-3.5 py-1.5 bg-paper hover:bg-wash text-ink rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors border border-hairline cursor-pointer shadow-sm"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              New Comparison
            </button>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODE B: COMPARE EXISTING PACKAGES FROM DATABASE */}
      {/* ========================================================================= */}
      {activeMode === "existing_db" && workflowState === "upload" && (
        <div className="bg-white border border-hairline rounded-xl p-6 space-y-6 shadow-xs">
          <div>
            <h2 className="text-sm font-bold text-ink font-headline uppercase tracking-wider">
              Pairwise Inspection Comparison (Database Records)
            </h2>
            <p className="text-xs text-ink-light mt-0.5">
              Select two previously processed package inspections to compare statutory fields and bounding boxes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-mono font-bold text-ink">Baseline Revision (A)</label>
              <select
                value={selectedA}
                onChange={(e) => setSelectedA(e.target.value)}
                className="w-full bg-paper border border-hairline rounded-lg p-3 text-xs text-ink font-mono focus:outline-none focus:border-seal"
              >
                {dbPackages.map((p) => (
                  <option key={p.package_id} value={p.package_id}>
                    {p.package_id} ({new Date(p.created_at).toLocaleDateString()})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono font-bold text-ink">Comparison Revision (B)</label>
              <select
                value={selectedB}
                onChange={(e) => setSelectedB(e.target.value)}
                className="w-full bg-paper border border-hairline rounded-lg p-3 text-xs text-ink font-mono focus:outline-none focus:border-seal"
              >
                {dbPackages.map((p) => (
                  <option key={p.package_id} value={p.package_id}>
                    {p.package_id} ({new Date(p.created_at).toLocaleDateString()})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {dbPairError && (
            <div className="p-3 rounded-lg bg-brick-light/20 border border-brick/40 text-brick text-xs font-mono">
              {dbPairError}
            </div>
          )}

          <button
            onClick={handleRunDbPairDiff}
            disabled={dbPairLoading || !selectedA || !selectedB}
            className="px-5 py-2.5 bg-seal text-white font-bold text-xs rounded-lg shadow-xs hover:bg-seal/90 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {dbPairLoading ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                <span>Comparing Records...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">compare_arrows</span>
                <span>Compare Revisions</span>
              </>
            )}
          </button>

          {/* Pairwise Diff Results */}
          {dbPairResult && (
            <div className="space-y-4 pt-4 border-t border-hairline">
              <div className="p-3 bg-wash rounded-lg border border-hairline font-mono text-xs text-ink">
                {dbPairResult.summary || "Comparison completed."}
              </div>

              <div className="divide-y divide-hairline border border-hairline rounded-xl overflow-hidden bg-white">
                {dbPairResult.field_diffs?.map((diff: any) => (
                  <div key={diff.field_name} className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                    <div>
                      <span className="font-mono text-xs font-bold text-ink">
                        {STATUTORY_FIELD_LABELS[diff.field_name] || diff.field_name}
                      </span>
                      <div className="mt-1">
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                            diff.significance === "LEGALLY_SIGNIFICANT"
                              ? "bg-brick-light text-brick border border-brick/30"
                              : diff.significance === "COSMETIC"
                              ? "bg-ochre-light text-ochre-dark border border-ochre/30"
                              : "bg-wash text-ink-light border border-hairline"
                          }`}
                        >
                          {diff.significance}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs font-mono bg-wash/60 p-2.5 rounded-lg border border-hairline">
                      <span className="text-ink-light text-[10px] block">Baseline (A):</span>
                      <span className="text-ink font-semibold">{diff.value_a || "—"}</span>
                    </div>
                    <div className="text-xs font-mono bg-wash/60 p-2.5 rounded-lg border border-hairline">
                      <span className="text-ink-light text-[10px] block">Revision (B):</span>
                      <span className="text-ink font-semibold">{diff.value_b || "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* STAGE 1: BATCH UPLOAD WITH DRAG-AND-DROP VERSION ORDERING (2-5 FILES) */}
      {/* ========================================================================= */}
      {activeMode === "batch_upload" && workflowState === "upload" && (
        selectedFiles.length < 2 ? (
          /* SINGLE FULL-PAGE PANEL */
          <div className="bg-white border border-hairline rounded-xl p-8 space-y-6 shadow-sm">
            {/* Header info */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-hairline pb-4">
              <div>
                <h3 className="text-base font-heading font-semibold text-ink">
                  Packaging Evolution Studio
                </h3>
                <p className="text-xs text-ink-light mt-0.5">
                  Upload 2 to 5 packaging label images across product revisions to audit LMPC compliance drift, unit economics, and formulation changes.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono px-2.5 py-1 rounded bg-wash border border-hairline text-ink-light">
                  Batch Multi-Revision Mode
                </span>
              </div>
            </div>

            {/* If 1 file selected, show the banner */}
            {selectedFiles.length === 1 && (
              <div className="flex items-center justify-between p-3.5 bg-seal/5 border border-seal/20 rounded-lg text-xs font-mono">
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-seal text-[18px]">info</span>
                  <div>
                    <span className="font-bold text-ink">1 Label Selected: </span>
                    <span className="text-seal font-semibold">{selectedFiles[0].name}</span>
                    <span className="text-ink-light text-[11px] ml-1.5">({(selectedFiles[0].size / 1024).toFixed(1)} KB)</span>
                    <p className="text-[11px] text-ink-light font-body mt-0.5">
                      Please upload at least 1 more revision (minimum 2, up to 5) to initiate comparative analysis.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(0)}
                  className="px-2.5 py-1 text-xs text-brick hover:bg-brick/10 rounded border border-brick/20 cursor-pointer transition-colors"
                >
                  Remove
                </button>
              </div>
            )}

            {/* Dropzone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => document.getElementById("multi-diff-file-input")?.click()}
              className="border-2 border-dashed border-hairline bg-wash/40 hover:border-seal hover:bg-wash/60 rounded-xl p-12 text-center transition-all cursor-pointer space-y-4 group"
            >
              <input
                id="multi-diff-file-input"
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="w-16 h-16 rounded-full bg-paper border border-hairline flex items-center justify-center text-seal shadow-xs mx-auto group-hover:scale-105 transition-transform">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="space-y-1">
                <span className="text-base font-heading font-semibold text-ink block">
                  Select or drop 2 to 5 packaging label images
                </span>
                <p className="text-xs text-ink-light max-w-md mx-auto font-body">
                  Upload packaging photographs or artworks in chronological order to detect price hikes, shrinkflation, and rule changes.
                </p>
                <span className="text-xs text-ink-light block font-mono pt-1">
                  PNG, JPG, JPEG, WebP · Minimum 2, Maximum 5 labels
                </span>
              </div>
              <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-paper border border-hairline text-xs font-heading font-semibold text-ink hover:bg-wash shadow-2xs transition-all">
                <span className="material-symbols-outlined text-[16px] text-seal">upload_file</span>
                Browse packaging files
              </span>
            </div>
          </div>
        ) : (
          /* TRANSFORMED 2-PANEL LAYOUT (>= 2 images) */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT PANEL: Upload & Add More (5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white border border-hairline rounded-xl p-5 space-y-4 shadow-sm">
                <div className="border-b border-hairline pb-3">
                  <h3 className="text-sm font-heading font-semibold text-ink flex items-center justify-between">
                    <span>Upload Revisions</span>
                    <span className="text-xs font-mono text-seal bg-seal/10 px-2 py-0.5 rounded font-bold">
                      {selectedFiles.length}/5 Labels
                    </span>
                  </h3>
                  <p className="text-xs text-ink-light mt-0.5">
                    {selectedFiles.length < 5
                      ? "Add more label revisions (up to 5 max) to expand comparative analysis."
                      : "Maximum capacity of 5 packaging revisions reached."}
                  </p>
                </div>

                {selectedFiles.length < 5 ? (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => document.getElementById("multi-diff-file-input-more")?.click()}
                    className="border-2 border-dashed border-hairline bg-wash/30 hover:border-seal hover:bg-wash/50 rounded-lg p-6 text-center transition-all cursor-pointer space-y-3 group"
                  >
                    <input
                      id="multi-diff-file-input-more"
                      type="file"
                      multiple
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <div className="w-10 h-10 rounded-full bg-paper border border-hairline flex items-center justify-center text-seal mx-auto shadow-2xs group-hover:scale-105 transition-transform">
                      <span className="material-symbols-outlined text-[20px]">add_photo_alternate</span>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-xs font-semibold text-ink block">
                        Drop packaging photo or browse
                      </span>
                      <span className="text-[11px] text-ink-light font-mono block">
                        Can add {5 - selectedFiles.length} more revision{5 - selectedFiles.length > 1 ? "s" : ""}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-white border border-hairline text-xs font-mono text-seal hover:bg-wash transition-colors">
                      <span className="material-symbols-outlined text-[14px]">add</span>
                      <span>Add Revision</span>
                    </span>
                  </div>
                ) : (
                  <div className="p-4 bg-wash/60 border border-hairline rounded-lg text-center text-xs font-mono text-ink-light space-y-1">
                    <span className="material-symbols-outlined text-[22px] text-stamp-green block mx-auto">task_alt</span>
                    <span className="font-semibold text-ink block">Max Revisions Reached</span>
                    <p className="text-[11px] font-body text-ink-light">
                      Remove an image from the right panel to replace it with a different packaging revision.
                    </p>
                  </div>
                )}

                {/* Regulatory / Pipeline Parameters */}
                <div className="pt-2 border-t border-hairline space-y-2 text-xs font-mono text-ink-light">
                  <div className="flex items-center justify-between">
                    <span>Audit Pipeline:</span>
                    <span className="text-ink font-semibold">LMPC 2011 Rules</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Perception Engine:</span>
                    <span className="text-ink font-semibold">RapidOCR Local</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Baseline Revision:</span>
                    <span className="text-seal font-semibold">Rev 1 (Oldest)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT PANEL: Uploaded images (2-5), Reordering, Review Checkbox, Analyze Button (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              <div className="bg-white border border-hairline rounded-xl p-5 space-y-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-ink uppercase tracking-wider font-mono">
                      Packaging Lineage Order ({selectedFiles.length} Revisions)
                    </h3>
                    <p className="text-[11px] text-ink-light font-body">
                      Drag cards or use arrow buttons to set chronological order (Rev 1 is oldest baseline).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoSortByDate(!autoSortByDate)}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors border cursor-pointer ${
                      autoSortByDate
                        ? "bg-seal text-white border-seal font-medium shadow-xs"
                        : "bg-paper text-ink-light border-hairline hover:text-ink"
                    }`}
                  >
                    Auto-Sort by Mfg Date: {autoSortByDate ? "ON" : "OFF"}
                  </button>
                </div>

                {/* Uploaded Cards Deck */}
                <div className="space-y-2.5">
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
                        className={`bg-paper border rounded-lg p-3 relative flex items-center justify-between gap-3 transition-all cursor-move ${
                          draggedIndex === idx
                            ? "border-seal opacity-60 scale-98"
                            : "border-hairline hover:border-seal/50 hover:bg-wash/30"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Drag handle */}
                          <span className="material-symbols-outlined text-ink-light text-[18px] shrink-0 cursor-grab">
                            drag_indicator
                          </span>

                          {/* Thumbnail */}
                          <div className="w-14 h-14 shrink-0 bg-wash rounded border border-hairline overflow-hidden flex items-center justify-center">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={URL.createObjectURL(file)}
                              alt={file.name}
                              className="w-full h-full object-cover pointer-events-none"
                            />
                          </div>

                          {/* Info */}
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-2 py-0.2 rounded text-[10px] font-mono font-bold uppercase ${
                                  isFirst
                                    ? "bg-seal-light text-seal border border-seal/30"
                                    : isLast
                                    ? "bg-stamp-green-light text-stamp-green-dark border border-stamp-green/30"
                                    : "bg-wash text-ink-light border border-hairline"
                                }`}
                              >
                                Rev {idx + 1} {isFirst ? "(Baseline)" : isLast ? "(Latest)" : ""}
                              </span>
                            </div>
                            <div className="text-xs font-mono text-ink truncate font-semibold" title={file.name}>
                              {file.name}
                            </div>
                            <div className="text-[10px] text-ink-light font-mono">
                              {(file.size / 1024).toFixed(1)} KB
                            </div>
                          </div>
                        </div>

                        {/* Controls: Move up/down and Delete */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={isFirst}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveFile(idx, idx - 1);
                            }}
                            className="p-1.5 rounded hover:bg-wash text-ink-light hover:text-seal disabled:opacity-20 cursor-pointer"
                            title="Move Earlier in Timeline"
                          >
                            <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                          </button>
                          <button
                            type="button"
                            disabled={isLast}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveFile(idx, idx + 1);
                            }}
                            className="p-1.5 rounded hover:bg-wash text-ink-light hover:text-seal disabled:opacity-20 cursor-pointer"
                            title="Move Later in Timeline"
                          >
                            <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFile(idx);
                            }}
                            className="p-1.5 rounded hover:bg-brick/10 text-brick cursor-pointer transition-colors"
                            title="Remove Revision"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Review Opt-In Checkbox - Styled Card */}
                <label
                  htmlFor="opt-in-review-checkbox"
                  className={`flex items-start gap-3.5 p-3.5 rounded-lg border transition-all cursor-pointer ${
                    optInReview
                      ? "bg-seal/5 border-seal shadow-xs"
                      : "bg-paper border-hairline hover:bg-wash"
                  }`}
                >
                  <div className="pt-0.5">
                    <div
                      className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                        optInReview
                          ? "bg-seal border-seal text-white"
                          : "border-hairline bg-white"
                      }`}
                    >
                      {optInReview && (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <input
                      type="checkbox"
                      id="opt-in-review-checkbox"
                      checked={optInReview}
                      onChange={(e) => setOptInReview(e.target.checked)}
                      className="sr-only"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-xs font-heading font-semibold text-ink block">
                      Review statutory declarations before analysis
                    </span>
                    <span className="text-[11px] text-ink-light leading-snug block">
                      Inspect and adjust extracted declarations, ingredients, allergens, and nutritional metrics prior to evaluation.
                    </span>
                  </div>
                </label>

                {/* CTA Analyze Button */}
                <div className="pt-1">
                  <button
                    onClick={handleStartAnalysis}
                    disabled={loading || selectedFiles.length < 2}
                    className="w-full py-3 px-6 bg-seal hover:bg-seal-light disabled:opacity-40 text-white rounded-md text-xs sm:text-sm font-heading font-semibold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                        <span>{loadingStep || "Processing Revisions..."}</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[18px]">compare</span>
                        <span>Start Multi-Revision Perception &amp; Evaluation ({selectedFiles.length} Labels)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      )}

      {/* ========================================================================= */}
      {/* STAGE 2: CONDITIONAL HUMAN REVIEW SPLIT-VIEW */}
      {/* ========================================================================= */}
      {workflowState === "review" && (
        <div id="declarations-review-container" className="bg-white border border-hairline rounded-lg p-6 space-y-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-hairline pb-4">
            <div>
              <h3 className="text-base font-heading font-semibold text-ink flex items-center gap-2">
                <span className="material-symbols-outlined text-seal text-[20px]">edit_note</span>
                Multi-Revision Declarations Review
              </h3>
              <p className="text-xs text-ink-light mt-0.5">
                Verify and edit the extracted statutory and non-statutory sections against the packaging label image.
              </p>
            </div>
            <button
              onClick={() => executeEvaluation(extractedPackages, autoSortByDate)}
              disabled={loading}
              className="py-2.5 px-5 bg-seal hover:bg-seal-light text-white rounded-md text-xs font-heading font-semibold transition-colors flex items-center gap-2 shadow-sm cursor-pointer"
            >
              {loading ? (
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
              ) : (
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              )}
              <span>Run Comparative Analysis</span>
            </button>
          </div>

          {/* Revision Selector Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-1 font-mono text-xs">
            {extractedPackages.map((pkg, idx) => (
              <button
                key={pkg.package_id}
                onClick={() => setActiveReviewTab(idx)}
                className={`py-2 px-4 rounded-md font-medium transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  activeReviewTab === idx
                    ? "bg-seal text-white shadow-sm"
                    : "bg-wash text-ink-light hover:text-ink border border-hairline"
                }`}
              >
                <span>Revision {idx + 1}</span>
                <span className={`text-[10px] ${activeReviewTab === idx ? "text-white/80" : "text-ink-light"}`}>
                  {pkg.filename ? `(${pkg.filename})` : `(${pkg.package_id})`}
                </span>
              </button>
            ))}
          </div>

          {/* Side-by-Side Review Grid: 4 cols image, 8 cols declarations */}
          {extractedPackages[activeReviewTab] && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left Column: Image Preview with Click-to-Enlarge */}
              <div className="lg:col-span-4 bg-wash border border-hairline rounded-lg p-4 flex flex-col space-y-3 lg:sticky lg:top-20">
                <div className="flex items-center justify-between pb-2 border-b border-hairline text-xs font-mono">
                  <span className="font-semibold text-ink truncate">
                    Rev {activeReviewTab + 1}: {extractedPackages[activeReviewTab].filename || "Label Preview"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setLightboxRevisionIndex(activeReviewTab);
                      setLightboxZoom(1);
                    }}
                    className="text-seal hover:underline text-[11px] flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <span className="material-symbols-outlined text-[14px]">fullscreen</span>
                    Enlarge
                  </button>
                </div>

                <div
                  className="w-full h-[320px] bg-white rounded-md flex items-center justify-center overflow-hidden border border-hairline relative p-2"
                >
                  <div
                    className="relative inline-block cursor-pointer group"
                    onClick={() => {
                      setLightboxRevisionIndex(activeReviewTab);
                      setLightboxZoom(1);
                    }}
                    title="Click to enlarge"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getFullImageUrl(extractedPackages[activeReviewTab].image_url)}
                      alt={`Revision ${activeReviewTab + 1}`}
                      onLoad={(e) => {
                        const { naturalWidth, naturalHeight } = e.currentTarget;
                        setImageSizes((prev) => ({
                          ...prev,
                          [activeReviewTab]: { width: naturalWidth, height: naturalHeight },
                        }));
                      }}
                      className="max-h-[300px] max-w-full object-contain rounded transition-transform duration-200 group-hover:scale-105 block"
                    />

                    {/* Bounding Boxes Overlays */}
                    {imageSizes[activeReviewTab] && (() => {
                      const fieldsData = extractedPackages[activeReviewTab].fields;
                      const fieldsArray = Array.isArray(fieldsData) ? fieldsData : Object.values(fieldsData || {});
                      return fieldsArray.map((f: any) => {
                        const size = imageSizes[activeReviewTab];
                        const [x, y, w, h] = f.bounding_box || [0, 0, 0, 0];
                        if (w <= 0 || h <= 0) return null;
                        if (x === 0 && y === 0 && ((w === 100 && h <= 100) || !f.raw_value || f.raw_value.trim() === "")) {
                          return null;
                        }

                        const leftPct = (x / size.width) * 100;
                        const topPct = (y / size.height) * 100;
                        const widthPct = (w / size.width) * 100;
                        const heightPct = (h / size.height) * 100;
                        const isHovered = hoveredField === f.field_name;
                        const isLow = f.confidence < 0.9;

                        return (
                          <div
                            key={f.field_name}
                            className={`absolute transition-all duration-150 rounded-xs pointer-events-none ${
                              isHovered
                                ? `border-[3px] z-30 shadow-md ring-2 ${isLow ? "ring-orange-400 border-orange-500 bg-orange-500/20" : "ring-green-400 border-green-500 bg-green-500/20"}`
                                : `border-[2px] z-10 ${isLow ? "border-dashed border-orange-500 bg-orange-500/20" : "border-green-500 bg-green-500/20"}`
                            }`}
                            style={{
                              left: `${leftPct}%`,
                              top: `${topPct}%`,
                              width: `${widthPct}%`,
                              height: `${heightPct}%`,
                              minWidth: "4px",
                              minHeight: "4px",
                            }}
                          >
                             <div className={`absolute top-0 left-full ml-1 ${isLow ? "bg-orange-500" : "bg-green-500"} text-white text-[10px] font-bold px-1.5 py-0.5 rounded-sm shadow-sm whitespace-nowrap z-40 flex items-center gap-1 ${isHovered ? "opacity-100" : "opacity-0"} transition-opacity duration-150`}>
                               <span>{STATUTORY_FIELD_LABELS[f.field_name] || f.field_name}</span>
                             </div>
                          </div>
                        );
                      });
                    })()}

                    <div className="absolute inset-0 bg-ink/15 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                      <span className="px-3 py-1.5 rounded-md bg-white text-ink text-xs font-mono font-medium shadow border border-hairline flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">zoom_in</span>
                        Enlarge
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] font-mono text-ink-light pt-1 text-center">
                  Click artwork to inspect with zoom &amp; pan
                </div>
              </div>

              {/* Right Column: Review Declarations (Spacious 8 columns) */}
              <div className="lg:col-span-8 space-y-4">
                {/* Section Selector Tabs */}
                <div className="flex border border-hairline text-xs font-mono gap-1 overflow-x-auto bg-wash p-1 rounded-md">
                  {(["statutory", "ingredients", "allergens", "nutrition", "claims"] as const).map((sec) => (
                    <button
                      key={sec}
                      onClick={() => setReviewSection(sec)}
                      className={`px-3 py-1.5 rounded transition-colors whitespace-nowrap capitalize cursor-pointer ${
                        reviewSection === sec
                          ? "bg-seal text-white font-medium shadow-sm"
                          : "text-ink-light hover:text-ink"
                      }`}
                    >
                      {sec === "statutory" ? "Statutory LMPC" : sec}
                    </button>
                  ))}
                </div>

                {/* Tab Content 1: Statutory */}
                {reviewSection === "statutory" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {Object.keys(STATUTORY_FIELD_LABELS).map((fname) => {
                      const fieldsData = extractedPackages[activeReviewTab].fields;
                      const fieldObj = Array.isArray(fieldsData) 
                        ? fieldsData.find((f: any) => f.field_name === fname) || {}
                        : fieldsData?.[fname] || {};
                      const currentValue = fieldObj.confirmed_value ?? fieldObj.raw_value ?? "";

                      return (
                        <div 
                          key={fname} 
                          className="bg-paper border border-hairline rounded-md p-3 space-y-1.5 transition-colors hover:bg-wash"
                          onMouseEnter={() => setHoveredField(fname)}
                          onMouseLeave={() => setHoveredField(null)}
                        >
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-ink">
                              {STATUTORY_FIELD_LABELS[fname]}
                            </label>
                            <span className="text-[10px] font-mono text-ink-light">
                              conf: {((fieldObj.confidence || 0.9) * 100).toFixed(0)}%
                            </span>
                          </div>

                          <input
                            type="text"
                            value={currentValue}
                            onChange={(e) => handleUpdateFieldValue(activeReviewTab, fname, e.target.value)}
                            className="w-full bg-white border border-hairline rounded p-2 text-xs font-mono text-ink focus:outline-none focus:border-seal"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Tab Content 2: Ingredients */}
                {reviewSection === "ingredients" && (
                  <div className="bg-paper border border-hairline rounded-md p-4 space-y-3">
                    <label className="text-xs font-semibold text-ink block font-heading">
                      Ingredients Declaration Text
                    </label>
                    <textarea
                      rows={8}
                      value={extractedPackages[activeReviewTab].extracted_non_statutory?.ingredients_text || ""}
                      onChange={(e) => handleUpdateNonStatutory(activeReviewTab, "ingredients_text", e.target.value)}
                      className="w-full bg-white border border-hairline rounded-md p-3 text-xs font-mono text-ink focus:outline-none focus:border-seal leading-relaxed"
                      placeholder="e.g. Wheat Flour (54%), Palm Oil, Sugar, Salt..."
                    />
                  </div>
                )}

                {/* Tab Content 3: Allergens */}
                {reviewSection === "allergens" && (
                  <div className="bg-paper border border-hairline rounded-md p-4 space-y-3">
                    <label className="text-xs font-semibold text-ink block font-heading">
                      Allergen Declarations &amp; Advisories
                    </label>
                    <textarea
                      rows={5}
                      value={
                        Array.isArray(extractedPackages[activeReviewTab].extracted_non_statutory?.allergens)
                          ? extractedPackages[activeReviewTab].extracted_non_statutory.allergens.join(", ")
                          : extractedPackages[activeReviewTab].extracted_non_statutory?.allergens_text || ""
                      }
                      onChange={(e) => {
                        const arr = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                        handleUpdateNonStatutory(activeReviewTab, "allergens", arr);
                      }}
                      className="w-full bg-white border border-hairline rounded-md p-3 text-xs font-mono text-ink focus:outline-none focus:border-seal leading-relaxed"
                      placeholder="e.g. Wheat, Milk, Soya (comma-separated)"
                    />
                  </div>
                )}

                {/* Tab Content 4: Nutrition */}
                {reviewSection === "nutrition" && (
                  <div className="bg-paper border border-hairline rounded-md p-4 space-y-3">
                    <label className="text-xs font-semibold text-ink block font-heading">
                      Nutritional Declarations (Per 100g/ml)
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono text-xs">
                      {["Energy", "Protein", "Carbohydrate", "Total Sugars", "Total Fat", "Sodium"].map((k) => (
                        <div key={k} className="bg-wash p-2.5 rounded-md border border-hairline">
                          <span className="text-[10px] text-ink-light block uppercase">{k.replace("_", " ")}</span>
                          <input
                            type="text"
                            value={extractedPackages[activeReviewTab].extracted_non_statutory?.nutrition_table?.[k] ?? extractedPackages[activeReviewTab].extracted_non_statutory?.nutrition?.[k] ?? ""}
                            onChange={(e) => {
                              const existingNut = extractedPackages[activeReviewTab].extracted_non_statutory?.nutrition_table || extractedPackages[activeReviewTab].extracted_non_statutory?.nutrition || {};
                              handleUpdateNonStatutory(activeReviewTab, "nutrition_table", { ...existingNut, [k]: e.target.value });
                            }}
                            className="w-full bg-white border border-hairline rounded text-ink font-semibold text-xs mt-1 p-1.5 focus:outline-none focus:border-seal"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tab Content 5: Marketing Claims */}
                {reviewSection === "claims" && (
                  <div className="bg-paper border border-hairline rounded-md p-4 space-y-3">
                    <label className="text-xs font-semibold text-ink block font-heading">
                      Promotional &amp; Marketing Claims
                    </label>
                    <textarea
                      rows={5}
                      value={
                        Array.isArray(extractedPackages[activeReviewTab].extracted_non_statutory?.marketing_claims)
                          ? extractedPackages[activeReviewTab].extracted_non_statutory.marketing_claims.join("\n")
                          : Array.isArray(extractedPackages[activeReviewTab].extracted_non_statutory?.claims)
                          ? extractedPackages[activeReviewTab].extracted_non_statutory.claims.join("\n")
                          : ""
                      }
                      onChange={(e) => {
                        const claims = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
                        handleUpdateNonStatutory(activeReviewTab, "marketing_claims", claims);
                      }}
                      className="w-full bg-white border border-hairline rounded-md p-3 text-xs font-mono text-ink focus:outline-none focus:border-seal"
                      placeholder="One claim per line, e.g.&#10;100% Whole Grain&#10;Zero Trans Fat"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* STAGE 3: MULTI-REVISION TIMELINE & EVOLUTION RESULTS */}
      {/* ========================================================================= */}
      {workflowState === "results" && diffResult && (
        <div id="variance-results-container" className="space-y-6">
          <div className="flex items-center justify-between pb-2 border-b border-hairline">
            <div>
              <h2 className="text-xl font-heading font-semibold text-ink">Evaluation & Variance Matrix</h2>
              <p className="text-sm text-ink-light">Comprehensive diff analysis across packaging revisions.</p>
            </div>
            <button
              onClick={() => setIsReportModalOpen(true)}
              className="px-4 py-1.5 bg-seal text-white font-mono text-xs rounded hover:bg-seal/90 shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
              Generate Report
            </button>
          </div>

          {/* Executive Insights Banner - Color Coordinated */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* 1. Pricing, Volume & Shrinkflation Radar */}
            <div
              className={`rounded-lg p-5 border flex flex-col justify-between shadow-sm ${
                diffResult.shrinkflation?.is_shrinkflation ||
                diffResult.packaging_evolution_summary?.has_price_change ||
                diffResult.packaging_evolution_summary?.has_quantity_change
                  ? "bg-brick-light/20 border-l-4 border-l-brick border-hairline"
                  : "bg-white border-l-4 border-l-stamp-green border-hairline"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <span className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 font-mono ${
                    diffResult.shrinkflation?.is_shrinkflation || diffResult.shrinkflation?.category === "PRICE_HIKE"
                      ? "text-brick"
                      : "text-ink"
                  }`}>
                    <span className="material-symbols-outlined text-[16px]">trending_up</span>
                    Pricing &amp; Volume Radar
                  </span>
                  {diffResult.shrinkflation?.is_shrinkflation ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-brick text-white font-mono shadow-sm">
                      Stealth Shrinkflation
                    </span>
                  ) : diffResult.shrinkflation?.category === "PRICE_HIKE" ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-brick text-white font-mono shadow-sm">
                      Price Hike
                    </span>
                  ) : diffResult.shrinkflation?.category === "DOWNSIZED" ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-ochre text-white font-mono shadow-sm">
                      Downsized
                    </span>
                  ) : diffResult.shrinkflation?.category === "PRICE_DROP" ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-stamp-green text-white font-mono shadow-sm">
                      Price Drop
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-wash text-ink-light font-mono border border-hairline">
                      Pricing Stable
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink leading-relaxed">
                  {diffResult.shrinkflation?.summary || "Unit pricing and packaging quantity remained constant across revisions."}
                </p>
              </div>

              {diffResult.shrinkflation && (
                <div className="mt-3 pt-3 border-t border-hairline space-y-1 text-xs font-mono">
                  {diffResult.shrinkflation.old_mrp && diffResult.shrinkflation.new_mrp && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-ink-light">MRP Drift:</span>
                      <span className="text-ink font-semibold">
                        {diffResult.shrinkflation.old_mrp} → {diffResult.shrinkflation.new_mrp}
                        {diffResult.shrinkflation.mrp_delta_pct != null && diffResult.shrinkflation.mrp_delta_pct !== 0 && (
                          <span
                            className={`ml-1.5 font-bold ${
                              diffResult.shrinkflation.mrp_delta_pct > 0 ? "text-brick" : "text-stamp-green"
                            }`}
                          >
                            ({diffResult.shrinkflation.mrp_delta_pct > 0 ? "+" : ""}
                            {diffResult.shrinkflation.mrp_delta_pct}%)
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {diffResult.shrinkflation.old_net_quantity && diffResult.shrinkflation.new_net_quantity && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-ink-light">Net Quantity:</span>
                      <span className="text-ink font-semibold">
                        {diffResult.shrinkflation.old_net_quantity} → {diffResult.shrinkflation.new_net_quantity}
                        {diffResult.shrinkflation.qty_delta_pct != null && diffResult.shrinkflation.qty_delta_pct !== 0 && (
                          <span
                            className={`ml-1.5 font-bold ${
                              diffResult.shrinkflation.qty_delta_pct > 0 ? "text-stamp-green" : "text-brick"
                            }`}
                          >
                            ({diffResult.shrinkflation.qty_delta_pct > 0 ? "+" : ""}
                            {diffResult.shrinkflation.qty_delta_pct}%)
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {diffResult.shrinkflation.unit_price_delta_pct != null && (
                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-hairline">
                      <span className="text-ink-light">Unit Economics:</span>
                      <span
                        className={`font-bold ${
                          diffResult.shrinkflation.unit_price_delta_pct > 0 ? "text-brick" : "text-stamp-green"
                        }`}
                      >
                        {diffResult.shrinkflation.unit_price_delta_pct > 0 ? "+" : ""}
                        {diffResult.shrinkflation.unit_price_delta_pct}% {diffResult.shrinkflation.unit}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2. Legal Metrology Compliance Drift */}
            <div
              className={`rounded-lg p-5 border flex flex-col justify-between shadow-sm ${
                diffResult.compliance_progression?.overall_drift === "REGRESSED" || (diffResult.compliance_progression?.regressions?.length || 0) > 0
                  ? "bg-brick-light/20 border-l-4 border-l-brick border-hairline"
                  : diffResult.compliance_progression?.overall_drift === "IMPROVED"
                  ? "bg-stamp-green-light/20 border-l-4 border-l-stamp-green border-hairline"
                  : "bg-white border-l-4 border-l-stamp-green/50 border-hairline"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink flex items-center gap-1.5 font-mono">
                    <span className="material-symbols-outlined text-[16px] text-seal">verified</span>
                    LMPC Compliance Drift
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded text-[10px] font-bold font-mono shadow-sm ${
                      diffResult.compliance_progression?.overall_drift === "IMPROVED"
                        ? "bg-stamp-green text-white"
                        : diffResult.compliance_progression?.overall_drift === "REGRESSED"
                        ? "bg-brick text-white"
                        : "bg-stamp-green-light text-stamp-green border border-stamp-green/30"
                    }`}
                  >
                    {diffResult.compliance_progression?.overall_drift || "COMPLIANT"}
                  </span>
                </div>
                <p className="text-xs text-ink leading-relaxed">
                  {diffResult.compliance_progression?.regressions?.length > 0
                    ? `Alert: ${diffResult.compliance_progression.regressions.length} statutory regression(s) detected in newer revisions.`
                    : diffResult.compliance_progression?.remediations?.length > 0
                    ? `Remediation verified: ${diffResult.compliance_progression.remediations.length} previous violation(s) were resolved.`
                    : "No statutory compliance regressions detected between batch revisions."}
                </p>
              </div>
              <div className="mt-3 pt-3 border-t border-hairline flex items-center justify-between text-[11px] font-mono text-ink-light">
                <span className="text-stamp-green font-medium">Remediated: {diffResult.compliance_progression?.remediations?.length || 0}</span>
                <span className={(diffResult.compliance_progression?.regressions?.length || 0) > 0 ? "text-brick font-bold" : ""}>
                  Regressions: {diffResult.compliance_progression?.regressions?.length || 0}
                </span>
              </div>
            </div>

            {/* 3. Allergen & Formulation Alert */}
            <div
              className={`rounded-lg p-5 border flex flex-col justify-between shadow-sm ${
                diffResult.allergens_diff?.risk_level === "HIGH"
                  ? "bg-brick-light/20 border-l-4 border-l-brick border-hairline"
                  : diffResult.allergens_diff?.added?.length > 0
                  ? "bg-ochre-light/20 border-l-4 border-l-ochre border-hairline"
                  : "bg-white border-l-4 border-l-hairline border-hairline"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink flex items-center gap-1.5 font-mono">
                    <span className="material-symbols-outlined text-[16px] text-ochre">warning</span>
                    Formulation &amp; Allergen Risk
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono shadow-sm ${
                    diffResult.allergens_diff?.risk_level === "HIGH"
                      ? "bg-brick text-white"
                      : diffResult.allergens_diff?.added?.length > 0
                      ? "bg-ochre text-white"
                      : "bg-wash text-ink-light border border-hairline"
                  }`}>
                    Risk: {diffResult.allergens_diff?.risk_level || "LOW"}
                  </span>
                </div>
                <p className="text-xs text-ink leading-relaxed">
                  {diffResult.allergens_diff?.risk_explanation ||
                    diffResult.ingredients_diff?.notes ||
                    "No critical allergen or ingredient substitutions detected."}
                </p>
              </div>
              {diffResult.allergens_diff?.added?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-hairline text-xs font-mono text-brick font-semibold">
                  New Allergens: {diffResult.allergens_diff.added.join(", ")}
                </div>
              )}
            </div>
          </div>

          {/* Key Packaging Evolution Shifts Banner */}
          {diffResult.packaging_evolution_summary?.key_shifts?.length > 0 && (
            <div className="bg-white border border-hairline rounded-lg p-5 space-y-2.5 shadow-sm">
              <div className="flex items-center gap-2 text-seal text-xs font-heading font-semibold uppercase tracking-wider">
                <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                <span>Packaging Evolution &amp; Variance Highlights</span>
              </div>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs font-mono text-ink">
                {diffResult.packaging_evolution_summary.key_shifts.map((shift: string, sIdx: number) => (
                  <li
                    key={sIdx}
                    className="flex items-start gap-2 bg-wash p-2.5 rounded-md border border-hairline"
                  >
                    <span className="material-symbols-outlined text-seal text-[14px] shrink-0 mt-0.5">arrow_forward</span>
                    <span>{shift}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Chronological Revision Cards Deck with Vibrant Color Coordination */}
          <div className="bg-white border border-hairline rounded-lg p-5 space-y-4 shadow-sm">
            <h3 className="text-xs font-heading font-semibold text-ink uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-seal text-[16px]">calendar_today</span>
                Packaging Evolution Lineage ({diffResult.num_revisions} Revisions)
              </span>
              <span className="text-[11px] text-ink-light font-normal font-mono">
                Click any thumbnail to enlarge high-res scan
              </span>
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

                return (
                  <div
                    key={rev.package_id}
                    className={`rounded-lg p-3.5 border transition-all flex flex-col justify-between shadow-sm ${
                      isFail
                        ? "bg-brick-light/20 border-2 border-brick"
                        : isReview
                        ? "bg-ochre-light/20 border-2 border-ochre"
                        : "bg-stamp-green-light/15 border-2 border-stamp-green"
                    }`}
                  >
                    <div>
                      {/* Badge Header with Unmistakable Color Coordination */}
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            isFirst
                              ? "bg-seal-light text-seal border border-seal/30"
                              : isLast
                              ? "bg-stamp-green-light text-stamp-green border border-stamp-green/30"
                              : "bg-wash text-ink-light border border-hairline"
                          }`}
                        >
                          Rev {idx + 1} {isFirst ? "(Base)" : isLast ? "(Latest)" : ""}
                        </span>
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded shadow-sm ${
                            isFail
                              ? "bg-brick text-white"
                              : isReview
                              ? "bg-ochre text-white"
                              : "bg-stamp-green text-white"
                          }`}
                        >
                          {overallResult === "FAIL" ? "NON-COMPLIANT" : overallResult === "PASS" ? "COMPLIANT" : "NEEDS REVIEW"}
                        </span>
                      </div>

                      {/* Clickable Image Thumbnail */}
                      <div
                        onClick={() => {
                          setLightboxRevisionIndex(idx);
                          setLightboxZoom(1);
                        }}
                        className="aspect-[4/3] bg-white rounded-md overflow-hidden mb-2.5 border border-hairline cursor-pointer relative group p-1 flex items-center justify-center"
                        title="Click to enlarge image"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={getFullImageUrl(rev.image_url)}
                          alt={`Rev ${idx + 1}`}
                          className="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-ink/15 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="p-1.5 rounded-md bg-white text-ink shadow border border-hairline">
                            <span className="material-symbols-outlined text-[16px]">zoom_in</span>
                          </span>
                        </div>
                      </div>

                      {/* Mfg Date & Key Fields */}
                      <div className="text-xs font-semibold text-ink truncate font-heading">
                        {rev.fields?.mfg_month_year || "Mfg: Not declared"}
                      </div>
                      <div className="text-[11px] font-mono text-ink-light mt-0.5">
                        MRP: <strong className="text-ink">{rev.fields?.mrp || "—"}</strong>
                      </div>
                      <div className="text-[11px] font-mono text-ink-light">
                        Qty: <strong className="text-ink">{rev.fields?.net_quantity || "—"}</strong>
                      </div>

                      {/* Step Deltas */}
                      {(mrpStepDelta || qtyStepDelta) && (
                        <div className="mt-2 pt-2 border-t border-hairline text-[11px] font-mono space-y-0.5">
                          {mrpStepDelta && <div className="text-brick font-semibold">{mrpStepDelta}</div>}
                          {qtyStepDelta && <div className="text-stamp-green font-semibold">{qtyStepDelta}</div>}
                        </div>
                      )}
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-hairline flex items-center justify-between text-[10px] font-mono text-ink-light">
                      <span className="truncate">
                        {rev.barcodes?.length > 0 ? `Barcode: ${rev.barcodes[0]}` : `Rev ${idx + 1}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setLightboxRevisionIndex(idx);
                          setLightboxZoom(1);
                        }}
                        className="text-seal hover:underline flex items-center gap-0.5 cursor-pointer font-medium"
                      >
                        <span className="material-symbols-outlined text-[13px]">fullscreen</span>
                        Enlarge
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Granular Comparative Matrix Tabs */}
          <div className="bg-white border border-hairline rounded-xl overflow-hidden shadow-xs">
            <div className="flex border-b border-hairline font-mono text-xs overflow-x-auto bg-wash/60 px-2 pt-2 gap-1">
              <button
                type="button"
                onClick={() => setActiveDiffTab("variance")}
                className={`py-2.5 px-4 font-bold transition-all whitespace-nowrap flex items-center gap-2 rounded-t-lg cursor-pointer ${
                  activeDiffTab === "variance"
                    ? "text-seal border-t-2 border-x border-hairline border-t-seal bg-white -mb-[1px] shadow-xs"
                    : "text-ink-light hover:text-ink hover:bg-paper"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">trending_up</span>
                <span>Packaging Variance &amp; Evolution</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveDiffTab("lmpc")}
                className={`py-2.5 px-4 font-bold transition-all whitespace-nowrap flex items-center gap-2 rounded-t-lg cursor-pointer ${
                  activeDiffTab === "lmpc"
                    ? "text-seal border-t-2 border-x border-hairline border-t-seal bg-white -mb-[1px] shadow-xs"
                    : "text-ink-light hover:text-ink hover:bg-paper"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">verified</span>
                <span>Statutory LMPC Rules Compliance</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveDiffTab("ingredients")}
                className={`py-2.5 px-4 font-bold transition-all whitespace-nowrap flex items-center gap-2 rounded-t-lg cursor-pointer ${
                  activeDiffTab === "ingredients"
                    ? "text-seal border-t-2 border-x border-hairline border-t-seal bg-white -mb-[1px] shadow-xs"
                    : "text-ink-light hover:text-ink hover:bg-paper"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">format_list_bulleted</span>
                <span>Ingredients Formulation</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveDiffTab("allergens")}
                className={`py-2.5 px-4 font-bold transition-all whitespace-nowrap flex items-center gap-2 rounded-t-lg cursor-pointer ${
                  activeDiffTab === "allergens"
                    ? "text-seal border-t-2 border-x border-hairline border-t-seal bg-white -mb-[1px] shadow-xs"
                    : "text-ink-light hover:text-ink hover:bg-paper"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">warning</span>
                <span>Allergen Advisories</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveDiffTab("nutrition")}
                className={`py-2.5 px-4 font-bold transition-all whitespace-nowrap flex items-center gap-2 rounded-t-lg cursor-pointer ${
                  activeDiffTab === "nutrition"
                    ? "text-seal border-t-2 border-x border-hairline border-t-seal bg-white -mb-[1px] shadow-xs"
                    : "text-ink-light hover:text-ink hover:bg-paper"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">info</span>
                <span>Nutrition &amp; Claims</span>
              </button>
            </div>

            {/* TAB 1: Variance & Evolution */}
            {activeDiffTab === "variance" && (
              <div className="p-6 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-ink uppercase tracking-wider font-mono flex items-center gap-2">
                      <span className="material-symbols-outlined text-seal text-[18px]">trending_up</span>
                      Statutory Declarations Trajectory
                    </h4>
                    <p className="text-xs text-ink-light mt-1 font-body">
                      Focuses primarily on statutory shifts across packaging revisions. Click or hover any shifted declaration to inspect detailed values.
                    </p>
                  </div>
                  <span className="text-xs font-mono text-ink-light bg-wash px-2.5 py-1 rounded border border-hairline shrink-0">
                    {diffResult.statutory_diffs?.filter((d: any) => d.changed).length || 0} Shifted Fields
                  </span>
                </div>

                {(() => {
                  const changedDiffs = diffResult.statutory_diffs?.filter((d: any) => d.changed) || [];
                  const unchangedDiffs = diffResult.statutory_diffs?.filter((d: any) => !d.changed) || [];

                  return (
                    <div className="space-y-4">
                      {/* PRIMARY: Changed Statutory Fields */}
                      {changedDiffs.length > 0 ? (
                        <div className="space-y-3">
                          {changedDiffs.map((diff: any) => {
                            const isPriceHike = diff.change_type === "INCREASE" && diff.field_name === "mrp";
                            const isPriceDrop = diff.change_type === "DECREASE" && diff.field_name === "mrp";
                            const isDownsized =
                              diff.change_type === "DOWNSIZED" ||
                              (diff.change_type === "DECREASE" && diff.field_name === "net_quantity");
                            const isQtyGain = diff.change_type === "INCREASE" && diff.field_name === "net_quantity";
                            const isExpanded = expandedStatutoryField === diff.field_name;

                            const firstVal = diff.values?.[0] || "—";
                            const lastVal = diff.values?.slice(-1)[0] || "—";

                            return (
                              <div
                                key={diff.field_name}
                                onMouseEnter={() => {
                                  if (!expandedStatutoryField) setExpandedStatutoryField(diff.field_name);
                                }}
                                className={`rounded-xl border transition-all ${
                                  isPriceHike || isDownsized
                                    ? "bg-brick-light/10 border-brick/40 hover:border-brick/70"
                                    : isPriceDrop || isQtyGain
                                    ? "bg-stamp-green-light/10 border-stamp-green/40 hover:border-stamp-green/70"
                                    : "bg-paper border-seal/40 hover:border-seal"
                                } shadow-xs`}
                              >
                                <div
                                  onClick={() => setExpandedStatutoryField(isExpanded ? null : diff.field_name)}
                                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer select-none"
                                >
                                  {/* Left: Field Name + Delta Badge */}
                                  <div className="flex items-center gap-2.5 flex-wrap">
                                    <span className="font-mono text-xs font-bold text-ink uppercase tracking-wide">
                                      {STATUTORY_FIELD_LABELS[diff.field_name] || diff.field_name}
                                    </span>

                                    {isPriceHike ? (
                                      <span className="px-2.5 py-0.5 rounded text-[11px] font-bold font-mono bg-brick text-white shadow-2xs flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[14px]">trending_up</span>
                                        <span>PRICE HIKE {diff.delta_badge}</span>
                                      </span>
                                    ) : isPriceDrop ? (
                                      <span className="px-2.5 py-0.5 rounded text-[11px] font-bold font-mono bg-stamp-green text-white shadow-2xs flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[14px]">trending_down</span>
                                        <span>PRICE REDUCED {diff.delta_badge}</span>
                                      </span>
                                    ) : isDownsized ? (
                                      <span className="px-2.5 py-0.5 rounded text-[11px] font-bold font-mono bg-brick text-white shadow-2xs flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[14px]">trending_down</span>
                                        <span>DOWNSIZED {diff.delta_badge}</span>
                                      </span>
                                    ) : isQtyGain ? (
                                      <span className="px-2.5 py-0.5 rounded text-[11px] font-bold font-mono bg-stamp-green text-white shadow-2xs flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[14px]">trending_up</span>
                                        <span>VOLUME GAIN {diff.delta_badge}</span>
                                      </span>
                                    ) : (
                                      <span className="px-2.5 py-0.5 rounded text-[11px] font-bold font-mono bg-ochre-light/30 text-ochre-dark border border-ochre/40">
                                        {diff.change_type} {diff.delta_badge ? `(${diff.delta_badge})` : ""}
                                      </span>
                                    )}
                                  </div>

                                  {/* Right: Concise Baseline → Latest comparison + Toggle */}
                                  <div className="flex items-center gap-3 font-mono text-xs">
                                    <div className="flex items-center gap-2 bg-white/80 px-3 py-1 rounded-md border border-hairline">
                                      <span className="text-ink-light text-[11px]">Rev 1:</span>
                                      <span className="text-ink font-semibold">{firstVal}</span>
                                      <span className="text-seal font-bold">→</span>
                                      <span className="text-ink-light text-[11px]">Rev {diff.values?.length}:</span>
                                      <span className="text-seal font-bold">{lastVal}</span>
                                    </div>

                                    <button
                                      type="button"
                                      className="p-1 rounded text-ink-light hover:text-seal cursor-pointer"
                                      title="Toggle full details"
                                    >
                                      <span className="material-symbols-outlined text-[18px]">
                                        {isExpanded ? "expand_less" : "expand_more"}
                                      </span>
                                    </button>
                                  </div>
                                </div>

                                {/* Expanded / Hovered Details: Full revision-by-revision trajectory */}
                                {isExpanded && (
                                  <div className="p-4 pt-2 border-t border-hairline/70 bg-wash/30 rounded-b-xl space-y-2 animate-in fade-in duration-100">
                                    <span className="text-[10px] font-mono font-bold uppercase text-ink-light block">
                                      Evolution Across All Revisions:
                                    </span>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 font-mono text-xs">
                                      {diff.values?.map((val: string, vIdx: number) => {
                                        const isFirst = vIdx === 0;
                                        const isLast = vIdx === diff.values.length - 1;
                                        return (
                                          <div
                                            key={vIdx}
                                            className={`p-3 rounded-lg border shadow-2xs ${
                                              isFirst
                                                ? "bg-white border-seal/30"
                                                : isLast
                                                ? "bg-white border-seal"
                                                : "bg-white border-hairline"
                                            }`}
                                          >
                                            <span className="text-[10px] text-ink-light uppercase font-bold block mb-1">
                                              Rev {vIdx + 1} {isFirst ? "(Base)" : isLast ? "(Latest)" : ""}
                                            </span>
                                            <span className="text-ink font-semibold break-words">{val || "—"}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-6 bg-stamp-green-light/10 border border-stamp-green/30 rounded-xl text-center space-y-1">
                          <span className="material-symbols-outlined text-stamp-green text-[28px]">verified</span>
                          <span className="text-sm font-heading font-semibold text-ink block">
                            All Statutory Declarations Completely Uniform
                          </span>
                          <p className="text-xs text-ink-light font-body">
                            No price inflation, shrinkflation, or packaging date discrepancies found across revisions.
                          </p>
                        </div>
                      )}

                      {/* UNCHANGED FIELDS: Collapsed Summary */}
                      {unchangedDiffs.length > 0 && (
                        <div className="bg-wash/50 border border-hairline rounded-xl p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-bold text-ink-light uppercase tracking-wider flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[16px] text-stamp-green">check_circle</span>
                              <span>Unchanged Declarations ({unchangedDiffs.length} Fields Uniform)</span>
                            </span>
                            <span className="text-[11px] font-mono text-ink-light">Zero drift across revisions</span>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {unchangedDiffs.map((diff: any) => (
                              <span
                                key={diff.field_name}
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono bg-white border border-hairline text-ink shadow-2xs"
                                title={`Identical across revisions: ${diff.values?.[0] || ""}`}
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-stamp-green" />
                                <span className="font-semibold">{STATUTORY_FIELD_LABELS[diff.field_name] || diff.field_name}</span>
                                <span className="text-ink-light text-[11px] truncate max-w-[140px]">({diff.values?.[0] || "—"})</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TAB 2: Statutory LMPC Rules Compliance Matrix */}
            {activeDiffTab === "lmpc" && (
              <div className="p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-hairline pb-4">
                  <div>
                    <h4 className="text-sm font-bold text-ink uppercase tracking-wider font-mono flex items-center gap-2">
                      <span className="material-symbols-outlined text-seal text-[18px]">verified</span>
                      Legal Metrology (LMPC) Statutory Rules Audit Matrix
                    </h4>
                    <p className="text-xs text-ink-light mt-0.5 font-body">
                      One-row-per-rule comparison. Extracted values are diffed word-by-word inline only when changed.
                    </p>
                  </div>

                  {/* Filter Pills */}
                  {(() => {
                    const rules = diffResult.lmpc_rules_matrix || [];
                    const changedRulesCount = rules.filter((r: any) => {
                      const evs = r.evaluations || [];
                      const v0 = (evs[0]?.extracted_value || "").trim();
                      const v1 = (evs[1]?.extracted_value || "").trim();
                      return v0 !== v1 || r.drift === "REMEDIATED" || r.drift === "REGRESSED";
                    }).length;
                    const unchangedRulesCount = rules.length - changedRulesCount;

                    return (
                      <div className="flex items-center gap-1.5 bg-wash/80 p-1 rounded-lg border border-hairline text-xs font-mono shrink-0">
                        <button
                          type="button"
                          onClick={() => setRuleMatrixFilter("all")}
                          className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                            ruleMatrixFilter === "all"
                              ? "bg-white text-ink font-bold shadow-xs border border-hairline"
                              : "text-ink-light hover:text-ink"
                          }`}
                        >
                          All ({rules.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setRuleMatrixFilter("changed")}
                          className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                            ruleMatrixFilter === "changed"
                              ? "bg-white text-seal font-bold shadow-xs border border-hairline"
                              : "text-ink-light hover:text-ink"
                          }`}
                        >
                          Changed ({changedRulesCount})
                        </button>
                        <button
                          type="button"
                          onClick={() => setRuleMatrixFilter("unchanged")}
                          className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                            ruleMatrixFilter === "unchanged"
                              ? "bg-white text-stamp-green-dark font-bold shadow-xs border border-hairline"
                              : "text-ink-light hover:text-ink"
                          }`}
                        >
                          Unchanged ({unchangedRulesCount})
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {diffResult.lmpc_rules_matrix && diffResult.lmpc_rules_matrix.length > 0 ? (
                  <div className="space-y-2">
                    {diffResult.lmpc_rules_matrix
                      .filter((ruleRow: any) => {
                        const evs = ruleRow.evaluations || [];
                        const v0 = (evs[0]?.extracted_value || "").trim();
                        const v1 = (evs[1]?.extracted_value || "").trim();
                        const isChanged = v0 !== v1 || ruleRow.drift === "REMEDIATED" || ruleRow.drift === "REGRESSED";
                        if (ruleMatrixFilter === "changed") return isChanged;
                        if (ruleMatrixFilter === "unchanged") return !isChanged;
                        return true;
                      })
                      .map((ruleRow: any) => {
                        const isExpanded = !!expandedRules[ruleRow.rule_id];
                        const isRemediated = ruleRow.drift === "REMEDIATED";
                        const isRegressed = ruleRow.drift === "REGRESSED";
                        const evs = ruleRow.evaluations || [];

                        const val0 = (evs[0]?.extracted_value || "").trim();
                        const val1 = (evs[1]?.extracted_value || "").trim();
                        const isValueIdentical = val0 === val1 || (!val0 && !val1);
                        const isStatusIdentical =
                          evs.length >= 2 &&
                          (evs[0]?.result === evs[1]?.result) &&
                          !isRemediated &&
                          !isRegressed;
                        const isUnchanged = isValueIdentical && isStatusIdentical;

                        const shortLabel =
                          RULE_SHORT_LABELS[ruleRow.rule_id] ||
                          (ruleRow.required_field ? STATUTORY_FIELD_LABELS[ruleRow.required_field] : "") ||
                          ruleRow.description.split("—")[0].split("declaration")[0].trim();

                        return (
                          <div
                            key={ruleRow.rule_id}
                            className={`rounded-xl border transition-all ${
                              isRegressed
                                ? "bg-brick-light/10 border-brick/40 hover:bg-brick-light/15"
                                : isRemediated
                                ? "bg-stamp-green-light/10 border-stamp-green/40 hover:bg-stamp-green-light/15"
                                : isUnchanged
                                ? "bg-white border-hairline hover:bg-wash/30"
                                : "bg-ochre-light/10 border-ochre/30 hover:bg-ochre-light/15"
                            }`}
                          >
                            <div
                              onClick={() => toggleRuleExpand(ruleRow.rule_id)}
                              className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer group select-none"
                            >
                              {/* 1. Rule Identification: ID + Short Name + 1-line small description */}
                              <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
                                <span className="p-0.5 text-ink-light group-hover:text-seal transition-colors shrink-0 mt-0.5 sm:mt-0">
                                  <span className="material-symbols-outlined text-[18px]">
                                    {isExpanded ? "expand_less" : "expand_more"}
                                  </span>
                                </span>
                                <span className="font-mono text-xs font-bold text-seal px-1.5 py-0.5 rounded bg-seal/10 border border-seal/20 shrink-0">
                                  {ruleRow.rule_id}
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-bold text-ink font-body truncate" title={ruleRow.description}>
                                      {shortLabel}
                                    </span>
                                    <span className="text-[10px] font-mono text-ink-light">
                                      ({ruleRow.citation})
                                    </span>
                                  </div>
                                  <span className="text-[11px] text-ink-light block truncate font-body">
                                    {ruleRow.description.split("—")[0].trim()}
                                  </span>
                                </div>
                              </div>

                              {/* 2. Outcome Badges Only */}
                              <div className="flex items-center gap-2 shrink-0 font-mono text-xs">
                                {evs.map((ev: any, eIdx: number) => {
                                  const pass = ev.result === "PASS";
                                  return (
                                    <div
                                      key={eIdx}
                                      className="flex items-center gap-1.5 bg-wash/80 px-2 py-0.5 rounded border border-hairline text-[11px]"
                                    >
                                      <span className="text-[10px] text-ink-light font-bold">Rev {eIdx + 1}:</span>
                                      {pass ? (
                                        <span className="flex items-center text-stamp-green-dark font-bold gap-0.5">
                                          <span className="material-symbols-outlined text-[14px] text-stamp-green">check_circle</span>
                                          PASS
                                        </span>
                                      ) : (
                                        <span className="flex items-center text-brick font-bold gap-0.5">
                                          <span className="material-symbols-outlined text-[14px] text-brick">cancel</span>
                                          FAIL
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}

                                {isRemediated && (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase bg-stamp-green text-white shadow-2xs">
                                    REMEDIATED
                                  </span>
                                )}
                                {isRegressed && (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase bg-brick text-white shadow-2xs">
                                    REGRESSED
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Detail Expansion on Click: Complete Extracted Text + Diff + Full Rule Description */}
                            {isExpanded && (
                              <div className="p-4 border-t border-hairline/80 space-y-3.5 text-xs bg-wash/40 rounded-b-xl animate-in fade-in duration-100">
                                {/* Rule Description & Citation */}
                                <div className="bg-white p-3 rounded-lg border border-hairline text-ink-light font-body space-y-1">
                                  <div className="font-semibold text-ink flex items-center justify-between gap-2">
                                    <span>{ruleRow.description}</span>
                                    <span className="text-[10px] font-mono text-seal bg-seal/10 px-2 py-0.5 rounded shrink-0">
                                      {ruleRow.citation}
                                    </span>
                                  </div>
                                  {ruleRow.required_field && (
                                    <div className="text-[11px] font-mono text-ink-light">
                                      Statutory Field: <span className="text-seal font-bold">{ruleRow.required_field}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Extracted Text & Word-Level Diff when changed */}
                                {!isUnchanged && val0 !== val1 && (
                                  <div className="bg-white p-3 rounded-lg border border-hairline space-y-2">
                                    <span className="text-[11px] font-mono font-bold uppercase text-ink-light block">
                                      Comparative Text Shift:
                                    </span>
                                    <div className="flex items-center gap-1.5 flex-wrap font-mono text-xs p-2 bg-wash/60 rounded border border-hairline/60">
                                      <span className="text-[10px] text-ink-light uppercase font-bold mr-1">Diff:</span>
                                      {computeWordDiff(val0, val1).map((chunk, cIdx) => (
                                        <span
                                          key={cIdx}
                                          className={
                                            chunk.removed
                                              ? "line-through bg-brick-light/30 text-brick px-1 py-0.5 rounded font-mono text-xs font-semibold"
                                              : chunk.added
                                              ? "bg-stamp-green-light/30 text-stamp-green-dark px-1 py-0.5 rounded font-mono text-xs font-bold"
                                              : "text-ink font-mono text-xs"
                                          }
                                        >
                                          {chunk.value}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Complete Extracted Text & Assessment Per Revision */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 font-mono text-xs">
                                  {evs.map((ev: any, eIdx: number) => (
                                    <div key={eIdx} className="bg-white p-3 rounded-lg border border-hairline space-y-2 shadow-2xs">
                                      <div className="flex items-center justify-between text-[11px] font-bold">
                                        <span className="text-ink-light">Rev {eIdx + 1} Assessment:</span>
                                        <span className={ev.result === "PASS" ? "text-stamp-green-dark" : "text-brick"}>
                                          {ev.display_result || ev.result}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-ink leading-snug font-body">{ev.notes}</p>
                                      <div className="pt-2 border-t border-hairline text-[11px] space-y-0.5">
                                        <span className="font-bold text-ink-light block text-[10px] uppercase">Complete Extracted Text:</span>
                                        <span className="text-ink font-mono block break-words bg-wash/50 p-1.5 rounded border border-hairline/60">
                                          {ev.extracted_value ? `"${ev.extracted_value}"` : "— (No text declared or detected)"}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <p className="text-xs text-ink-light font-mono">No LMPC statutory rules evaluated.</p>
                )}
              </div>
            )}

            {/* TAB 3: Ingredients Formulation */}
            {activeDiffTab === "ingredients" && (
              <div className="p-6 space-y-6">
                {(() => {
                  const ing = diffResult.ingredients_diff || {};
                  const added = (ing.added || []) as string[];
                  const removed = (ing.removed || []) as string[];
                  const synPairs = detectSynonymousIngredients(diffResult.revisions || [], ing.substitutions || []);

                  return (
                    <div className="space-y-6">
                      {/* TOP SECTION: Synonymous Names & Added/Removed Ingredients (NOT unchanged) */}
                      <div className="bg-white border border-hairline rounded-xl p-5 space-y-4 shadow-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-hairline pb-3">
                          <div>
                            <h4 className="text-xs font-bold text-ink uppercase tracking-wider font-mono flex items-center gap-2">
                              <span className="material-symbols-outlined text-seal text-[16px]">kitchen</span>
                              Ingredient Shifts &amp; Equivalent Declarations
                            </h4>
                            <p className="text-[11px] text-ink-light mt-0.5 font-body">
                              Recognizes ingredients that are identical but named differently, alongside genuine recipe additions and removals.
                            </p>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] font-mono">
                            <span className="flex items-center gap-1 text-seal font-bold">
                              <span className="w-2 h-2 rounded-full bg-seal" /> Renamed / Synonymous
                            </span>
                            <span className="flex items-center gap-1 text-stamp-green-dark font-bold">
                              <span className="w-2 h-2 rounded-full bg-stamp-green" /> Added
                            </span>
                            <span className="flex items-center gap-1 text-brick font-bold">
                              <span className="w-2 h-2 rounded-full bg-brick" /> Removed
                            </span>
                          </div>
                        </div>

                        {/* 1. Synonymous / Same Ingredient Named Differently */}
                        {synPairs.length > 0 && (
                          <div className="space-y-2">
                            <span className="text-[11px] font-mono font-bold uppercase text-seal block">
                              Equivalent Declarations (Same Ingredient, Different Wording):
                            </span>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {synPairs.map((pair, pIdx) => (
                                <div
                                  key={pIdx}
                                  className="p-3 bg-seal/5 border border-seal/20 rounded-lg flex items-center justify-between gap-2 text-xs font-mono shadow-2xs"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="material-symbols-outlined text-[16px] text-seal shrink-0">sync_alt</span>
                                    <div className="min-w-0">
                                      <span className="font-bold text-ink truncate block" title={pair.nameA}>
                                        &ldquo;{pair.nameA}&rdquo;
                                      </span>
                                      <span className="text-[10px] text-ink-light block font-body">
                                        is same as <span className="font-bold text-seal font-mono">&ldquo;{pair.nameB}&rdquo;</span>
                                      </span>
                                    </div>
                                  </div>
                                  <span className="text-[10px] font-bold text-seal bg-white px-2 py-0.5 rounded border border-seal/30 shrink-0">
                                    Equivalent
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 2. Added and Removed Ingredients (Unchanged excluded from this top view) */}
                        <div className="space-y-2 pt-1">
                          <span className="text-[11px] font-mono font-bold uppercase text-ink-light block">
                            Recipe Additions &amp; Removals:
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {/* Added */}
                            {added.map((item: string, aIdx: number) => (
                              <span
                                key={`add-${aIdx}`}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-stamp-green-light/30 text-stamp-green-dark border border-stamp-green/40 shadow-2xs"
                              >
                                <span className="text-stamp-green font-bold">+</span>
                                <span>{item}</span>
                                <span className="text-[10px] text-stamp-green-dark/80 font-normal ml-0.5">(Added)</span>
                              </span>
                            ))}

                            {/* Removed */}
                            {removed.map((item: string, rIdx: number) => (
                              <span
                                key={`rem-${rIdx}`}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-mono line-through bg-brick-light/20 text-brick border border-brick/30 shadow-2xs"
                              >
                                <span className="font-bold">-</span>
                                <span>{item}</span>
                                <span className="text-[10px] text-brick/80 font-normal ml-0.5">(Removed)</span>
                              </span>
                            ))}

                            {added.length === 0 && removed.length === 0 && (
                              <span className="text-xs font-mono text-ink-light italic">
                                No ingredients added or removed across packaging revisions.
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Summary notes */}
                        <p className="text-xs text-ink-light leading-relaxed pt-2 border-t border-hairline/70 font-body">
                          {diffResult.ingredients_diff?.notes || "Recipe formulation and ingredient declarations remained uniform."}
                        </p>
                      </div>

                      {/* MIDDLE SECTION: Recipe Percentage & Ratio Adjustments */}
                      {diffResult.ingredients_diff?.percentage_changes?.length > 0 && (
                        <div className="space-y-2.5">
                          <h4 className="text-xs font-bold text-ink uppercase tracking-wider font-mono flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[16px]">percent</span>
                            Recipe Percentage &amp; Ratio Adjustments
                          </h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                            {diffResult.ingredients_diff.percentage_changes.map((pc: any, pIdx: number) => (
                              <div
                                key={pIdx}
                                className="bg-white border border-hairline rounded-lg p-3 text-xs flex flex-col gap-1 font-mono shadow-xs"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-ink font-bold">{pc.ingredient}</span>
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-seal/10 text-seal border border-seal/20">
                                    {pc.change}
                                  </span>
                                </div>
                                {pc.detail && (
                                  <span className="text-ink-light text-[11px] font-body">
                                    {pc.detail}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* BOTTOM SECTION: Complete Ingredients List Per Revision With Color Highlights */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-hairline pb-2">
                          <h4 className="text-xs font-bold text-ink uppercase tracking-wider font-mono flex items-center gap-2">
                            <span className="material-symbols-outlined text-seal text-[16px]">format_list_numbered</span>
                            Complete Ingredients List (With Added &amp; Removed Highlights)
                          </h4>
                          <span className="text-[11px] font-mono text-ink-light">
                            Full declared formulations across all {diffResult.num_revisions} revisions
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                          {diffResult.revisions.map((rev: any, rIdx: number) => {
                            const nonStat = rev.extracted_non_statutory || {};
                            const ingList = (nonStat.ingredients_list || []) as string[];
                            const ingText = nonStat.ingredients_text || "";

                            return (
                              <div
                                key={rev.package_id}
                                className="bg-white border border-hairline rounded-lg p-3.5 space-y-3 flex flex-col justify-between shadow-xs"
                              >
                                <div>
                                  <div className="flex items-center justify-between border-b border-hairline pb-1.5 mb-2">
                                    <span className="font-mono text-xs font-bold text-seal">
                                      Rev {rIdx + 1} Formulation
                                    </span>
                                    <span className="text-[10px] font-mono text-ink-light">
                                      {ingList.length} Items
                                    </span>
                                  </div>

                                  {ingList.length > 0 ? (
                                    <ul className="space-y-1.5 font-mono text-xs">
                                      {ingList.map((item: string, iIdx: number) => {
                                        const normItem = item.toLowerCase();
                                        const isItemAdded = added.some((a) => normItem.includes(a.toLowerCase()) || a.toLowerCase().includes(normItem));
                                        const isItemRemoved = removed.some((r) => normItem.includes(r.toLowerCase()) || r.toLowerCase().includes(normItem));
                                        const isSynonym = synPairs.some(
                                          (p) =>
                                            normItem.includes(p.nameA.toLowerCase()) ||
                                            normItem.includes(p.nameB.toLowerCase())
                                        );

                                        let styleClass = "bg-wash/60 border-hairline text-ink";
                                        let badgeText: string | null = null;
                                        let badgeClass = "";

                                        if (isItemAdded) {
                                          styleClass = "bg-stamp-green-light/25 border-stamp-green/40 text-stamp-green-dark font-semibold";
                                          badgeText = "+ Added";
                                          badgeClass = "bg-stamp-green text-white";
                                        } else if (isItemRemoved) {
                                          styleClass = "bg-brick-light/20 border-brick/30 text-brick line-through";
                                          badgeText = "- Removed";
                                          badgeClass = "bg-brick text-white";
                                        } else if (isSynonym) {
                                          styleClass = "bg-seal/10 border-seal/30 text-seal font-medium";
                                          badgeText = "Renamed";
                                          badgeClass = "bg-seal text-white";
                                        }

                                        return (
                                          <li
                                            key={iIdx}
                                            className={`p-2 rounded border flex items-center justify-between gap-1.5 transition-colors ${styleClass}`}
                                          >
                                            <span className="truncate flex-1" title={item}>{item}</span>
                                            {badgeText && (
                                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold font-mono shrink-0 uppercase ${badgeClass}`}>
                                                {badgeText}
                                              </span>
                                            )}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  ) : ingText ? (
                                    <p className="text-xs font-mono text-ink whitespace-pre-wrap leading-relaxed">
                                      {ingText}
                                    </p>
                                  ) : (
                                    <p className="text-xs text-ink-light italic">No ingredients extracted.</p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TAB 4: Allergen Advisories */}
            {activeDiffTab === "allergens" && (
              <div className="p-6 space-y-6">
                {(() => {
                  const alg = diffResult.allergens_diff || {};
                  const added = (alg.added || []) as string[];
                  const removed = (alg.removed || []) as string[];

                  return (
                    <div className="space-y-6">
                      {/* TOP SECTION: Added & Removed Allergens (Unchanged excluded from top) */}
                      <div className="bg-white border border-hairline rounded-xl p-5 space-y-4 shadow-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-hairline pb-3">
                          <div>
                            <h4 className="text-xs font-bold text-ink uppercase tracking-wider font-mono flex items-center gap-2">
                              <span className="material-symbols-outlined text-brick text-[16px]">warning</span>
                              Allergen Advisory Shifts
                            </h4>
                            <p className="text-[11px] text-ink-light mt-0.5 font-body">
                              Instant detection of newly declared allergen hazards versus dropped advisory warnings.
                            </p>
                          </div>
                          <span
                            className={`px-2.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                              alg.risk_level === "HIGH"
                                ? "bg-brick text-white"
                                : "bg-wash text-ink-light border border-hairline"
                            }`}
                          >
                            Risk Level: {alg.risk_level || "LOW"}
                          </span>
                        </div>

                        {/* Tag Cloud of Added & Removed only */}
                        <div className="space-y-2">
                          <span className="text-[11px] font-mono font-bold uppercase text-ink-light block">
                            Added &amp; Dropped Allergen Warnings:
                          </span>
                          <div className="flex flex-wrap gap-2 pt-1">
                            {/* Added Allergens */}
                            {added.map((item: string, aIdx: number) => (
                              <span
                                key={`alg-add-${aIdx}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-brick text-white shadow-xs"
                              >
                                <span className="font-bold">+</span>
                                <span>{item} (Newly Declared)</span>
                              </span>
                            ))}

                            {/* Dropped Allergens */}
                            {removed.map((item: string, rIdx: number) => (
                              <span
                                key={`alg-rem-${rIdx}`}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-mono line-through bg-wash text-brick border border-brick/30 shadow-2xs"
                              >
                                <span className="font-bold">-</span>
                                <span>{item} (Dropped)</span>
                              </span>
                            ))}

                            {added.length === 0 && removed.length === 0 && (
                              <span className="text-xs font-mono text-ink-light italic">
                                No allergen additions or removals detected across revisions.
                              </span>
                            )}
                          </div>
                        </div>

                        <p className="text-xs text-ink-light leading-relaxed pt-2 border-t border-hairline/70 font-body">
                          {alg.risk_explanation || "No new allergen risks identified across packaging revisions."}
                        </p>
                      </div>

                      {/* BOTTOM SECTION: Complete Allergen List Per Revision */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-hairline pb-2">
                          <h4 className="text-xs font-bold text-ink uppercase tracking-wider font-mono">
                            Complete Declared Allergens Per Revision
                          </h4>
                          <span className="text-[11px] font-mono text-ink-light">
                            All allergen advisories declared per packaging label
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                          {diffResult.revisions.map((rev: any, rIdx: number) => {
                            const nonStat = rev.extracted_non_statutory || {};
                            const allergens = Array.isArray(nonStat.allergens)
                              ? nonStat.allergens
                              : nonStat.allergens_text
                              ? [nonStat.allergens_text]
                              : [];

                            return (
                              <div key={rev.package_id} className="bg-white border border-hairline rounded-lg p-3.5 space-y-2.5 shadow-xs">
                                <div className="flex items-center justify-between border-b border-hairline pb-1.5">
                                  <span className="font-mono text-xs font-bold text-seal">
                                    Rev {rIdx + 1} Allergens
                                  </span>
                                  <span className="text-[10px] font-mono text-ink-light">
                                    {allergens.length} Declared
                                  </span>
                                </div>

                                {allergens.length > 0 ? (
                                  <div className="flex flex-col gap-1.5">
                                    {allergens.map((a: string, aIdx: number) => {
                                      const isAdded = added.some((item) => item.toLowerCase() === a.toLowerCase());
                                      const isRemoved = removed.some((item) => item.toLowerCase() === a.toLowerCase());

                                      return (
                                        <span
                                          key={aIdx}
                                          className={`px-2 py-1 rounded text-[11px] font-mono border flex items-center justify-between ${
                                            isAdded
                                              ? "bg-brick-light/20 text-brick border-brick/40 font-bold"
                                              : isRemoved
                                              ? "bg-wash text-ink-light border-hairline line-through"
                                              : "bg-wash/70 text-ink border-hairline font-medium"
                                          }`}
                                        >
                                          <span>{a}</span>
                                          {isAdded && (
                                            <span className="text-[9px] bg-brick text-white px-1 rounded uppercase font-bold">
                                              New
                                            </span>
                                          )}
                                        </span>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="text-xs text-ink-light italic font-mono">No allergens declared.</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TAB 5: Nutrition Facts & Marketing Claims */}
            {activeDiffTab === "nutrition" && (
              <div className="p-6 space-y-6">
                {/* Nutritional Shifts Banner with Directional Colors */}
                <div className="bg-wash/50 border border-hairline rounded-lg p-4 space-y-2">
                  <h4 className="text-xs font-bold text-ink uppercase tracking-wider font-mono">
                    Nutritional Facts Shifts
                  </h4>
                  {diffResult.nutritional_diff?.significant_changes?.length > 0 ? (
                    <ul className="space-y-1.5 text-xs font-mono text-ink">
                      {diffResult.nutritional_diff.significant_changes.map((change: string, nIdx: number) => {
                        const isIncrease = change.toLowerCase().includes("increase") || change.toLowerCase().includes("rose") || change.includes("+");
                        const isDecrease = change.toLowerCase().includes("decrease") || change.toLowerCase().includes("reduced") || change.toLowerCase().includes("drop");

                        return (
                          <li key={nIdx} className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isIncrease ? "bg-brick" : isDecrease ? "bg-stamp-green" : "bg-seal"
                              }`}
                            />
                            <span className="leading-snug">{change}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-xs text-ink-light font-mono">No significant nutritional shifts flagged across revisions.</p>
                  )}
                </div>

                {/* Side-by-Side Nutritional Facts Table with Increase/Decrease Colors */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-hairline pb-2">
                    <h4 className="text-xs font-bold text-ink uppercase tracking-wider font-mono">
                      Nutritional Values Matrix (Per 100g/ml)
                    </h4>
                    <div className="flex items-center gap-3 text-[10px] font-mono">
                      <span className="flex items-center gap-1 text-stamp-green-dark font-bold">
                        <span className="w-2 h-2 rounded-full bg-stamp-green" /> Increase in Nutrient
                      </span>
                      <span className="flex items-center gap-1 text-brick font-bold">
                        <span className="w-2 h-2 rounded-full bg-brick" /> Decrease in Nutrient
                      </span>
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-hairline rounded-lg bg-white shadow-xs">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-wash border-b border-hairline text-ink uppercase text-[10px]">
                        <tr>
                          <th className="p-3">Nutrient</th>
                          {diffResult.revisions.map((_: any, idx: number) => (
                            <th key={idx} className="p-3">
                              Rev {idx + 1} {idx === 0 ? "(Baseline)" : ""}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {STANDARD_NUTRIENTS.map((nutrient) => {
                          const baseTable =
                            diffResult.revisions[0]?.extracted_non_statutory?.nutrition_table ||
                            diffResult.revisions[0]?.extracted_non_statutory?.nutrition ||
                            {};
                          const baseMatchKey = Object.keys(baseTable).find(
                            (k) =>
                              k.toLowerCase() === nutrient.toLowerCase() ||
                              k.toLowerCase().includes(nutrient.toLowerCase().replace("total ", ""))
                          );
                          const baseVal = baseMatchKey ? baseTable[baseMatchKey] : "—";
                          const parsedBase = parseNutrientNum(baseVal);

                          return (
                            <tr key={nutrient} className="hover:bg-wash/40 transition-colors">
                              <td className="p-3 font-semibold text-ink">{nutrient}</td>
                              {diffResult.revisions.map((rev: any, rIdx: number) => {
                                const nutTable =
                                  rev.extracted_non_statutory?.nutrition_table ||
                                  rev.extracted_non_statutory?.nutrition ||
                                  {};

                                const matchKey = Object.keys(nutTable).find(
                                  (k) =>
                                    k.toLowerCase() === nutrient.toLowerCase() ||
                                    k.toLowerCase().includes(nutrient.toLowerCase().replace("total ", ""))
                                );
                                const val = matchKey ? nutTable[matchKey] : "—";
                                const parsedCurrent = parseNutrientNum(val);

                                if (rIdx === 0) {
                                  return (
                                    <td key={rIdx} className="p-3 text-ink font-semibold">
                                      {val || "—"}
                                    </td>
                                  );
                                }

                                const hasDelta = parsedCurrent && parsedBase && parsedCurrent.num !== parsedBase.num;
                                const isIncrease = parsedCurrent && parsedBase && parsedCurrent.num > parsedBase.num;
                                const isDecrease = parsedCurrent && parsedBase && parsedCurrent.num < parsedBase.num;
                                const diffNum = hasDelta ? Math.abs(parsedCurrent.num - parsedBase.num).toFixed(1) : null;

                                return (
                                  <td key={rIdx} className="p-3">
                                    <div className="flex items-center gap-2">
                                      <span className="text-ink font-medium">{val || "—"}</span>
                                      {isIncrease && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold font-mono bg-stamp-green-light/30 text-stamp-green-dark border border-stamp-green/40 shadow-2xs">
                                          <span>↑</span>
                                          <span>+{diffNum}{parsedCurrent?.unit}</span>
                                        </span>
                                      )}
                                      {isDecrease && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold font-mono bg-brick-light/20 text-brick border border-brick/30 shadow-2xs">
                                          <span>↓</span>
                                          <span>-{diffNum}{parsedCurrent?.unit}</span>
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Marketing Claims Side-by-Side */}
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-bold text-seal uppercase tracking-wider font-mono">
                    Marketing Claims &amp; Product Badges Side-by-Side
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {diffResult.revisions.map((rev: any, rIdx: number) => {
                      const claims =
                        rev.extracted_non_statutory?.marketing_claims ||
                        rev.extracted_non_statutory?.claims ||
                        [];

                      return (
                        <div key={rev.package_id} className="bg-white border border-hairline rounded-lg p-3.5 space-y-2 shadow-xs">
                          <span className="font-mono text-xs font-bold text-seal block border-b border-hairline pb-1.5 mb-2">
                            Rev {rIdx + 1} Claims
                          </span>
                          {Array.isArray(claims) && claims.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {claims.map((claim: string, cIdx: number) => (
                                <span
                                  key={cIdx}
                                  className="px-2 py-0.5 rounded text-[11px] font-mono bg-seal/10 text-seal border border-seal/20"
                                >
                                  {claim}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-ink-light italic font-mono">No promotional claims declared.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Claims Diff Summary */}
                {diffResult.marketing_claims_diff && (
                  <div className="grid grid-cols-1 md:md:grid-cols-2 gap-4 pt-2">
                    {diffResult.marketing_claims_diff.added?.length > 0 && (
                      <div className="bg-white border border-hairline rounded-lg p-4 space-y-2 shadow-xs">
                        <span className="text-xs font-mono font-bold text-seal block uppercase">
                          New Marketing Claims Introduced
                        </span>
                        <ul className="list-disc list-inside text-xs font-mono text-ink space-y-1">
                          {diffResult.marketing_claims_diff.added.map((c: string, i: number) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {diffResult.marketing_claims_diff.removed?.length > 0 && (
                      <div className="bg-white border border-hairline rounded-lg p-4 space-y-2 shadow-xs">
                        <span className="text-xs font-mono font-bold text-ink-light block uppercase">
                          Claims Discontinued
                        </span>
                        <ul className="list-disc list-inside text-xs font-mono text-ink-light space-y-1">
                          {diffResult.marketing_claims_diff.removed.map((c: string, i: number) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* HIGH-RESOLUTION IMAGE LIGHTBOX MODAL */}
      {/* ========================================================================= */}
      {lightboxRevisionIndex !== null && diffResult?.revisions?.[lightboxRevisionIndex] && (
        <div
          onClick={() => setLightboxRevisionIndex(null)}
          className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex flex-col items-center justify-between p-4 sm:p-6 animate-fadeIn"
        >
          {/* Lightbox Header Bar */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-5xl bg-white border border-hairline rounded-xl px-5 py-3 flex items-center justify-between shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-0.5 rounded bg-seal/10 text-seal font-mono text-xs font-bold border border-seal/20">
                Revision {lightboxRevisionIndex + 1} of {diffResult.revisions.length}
              </span>
              <span className="text-xs font-heading font-bold text-ink truncate hidden sm:inline">
                {diffResult.revisions[lightboxRevisionIndex].fields?.common_name || "Packaging Scan"}
              </span>
              <span className="text-xs font-mono text-ink-light hidden md:inline">
                • {diffResult.revisions[lightboxRevisionIndex].fields?.mfg_month_year || "Date not detected"}
              </span>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2 font-mono text-xs">
              <button
                type="button"
                onClick={() => setLightboxZoom((z) => Math.max(0.6, z - 0.25))}
                className="p-1.5 rounded bg-wash hover:bg-paper border border-hairline text-ink transition-colors cursor-pointer"
                title="Zoom Out"
              >
                <span className="material-symbols-outlined text-[18px]">zoom_out</span>
              </button>
              <span className="px-2 py-0.5 text-ink font-semibold text-xs">
                {Math.round(lightboxZoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setLightboxZoom((z) => Math.min(3.0, z + 0.25))}
                className="p-1.5 rounded bg-wash hover:bg-paper border border-hairline text-ink transition-colors cursor-pointer"
                title="Zoom In"
              >
                <span className="material-symbols-outlined text-[18px]">zoom_in</span>
              </button>
              <button
                type="button"
                onClick={() => setLightboxZoom(1)}
                className="p-1.5 rounded bg-wash hover:bg-paper border border-hairline text-ink transition-colors cursor-pointer"
                title="Reset Zoom"
              >
                <span className="material-symbols-outlined text-[18px]">restart_alt</span>
              </button>

              <div className="h-4 w-px bg-hairline mx-1" />

              <button
                type="button"
                onClick={() => setLightboxRevisionIndex(null)}
                className="p-1.5 rounded bg-brick-light/30 hover:bg-brick-light/60 text-brick border border-brick/30 transition-colors cursor-pointer"
                title="Close (Esc)"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          </div>

          {/* Main Image Viewport */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex-1 w-full max-w-5xl my-4 flex items-center justify-center overflow-auto rounded-xl bg-wash/80 border border-hairline p-6 relative shadow-inner"
          >
            {/* Prev Revision Button */}
            {lightboxRevisionIndex > 0 && (
              <button
                type="button"
                onClick={() => {
                  setLightboxRevisionIndex((prev) => (prev !== null ? prev - 1 : 0));
                  setLightboxZoom(1);
                }}
                className="absolute left-4 z-10 p-3 rounded-full bg-white hover:bg-wash text-ink shadow-lg border border-hairline transition-transform hover:scale-105 cursor-pointer"
                title="Previous Revision (Left Arrow)"
              >
                <span className="material-symbols-outlined text-[24px]">chevron_left</span>
              </button>
            )}

            {/* Next Revision Button */}
            {lightboxRevisionIndex < diffResult.revisions.length - 1 && (
              <button
                type="button"
                onClick={() => {
                  setLightboxRevisionIndex((prev) => (prev !== null ? prev + 1 : 0));
                  setLightboxZoom(1);
                }}
                className="absolute right-4 z-10 p-3 rounded-full bg-white hover:bg-wash text-ink shadow-lg border border-hairline transition-transform hover:scale-105 cursor-pointer"
                title="Next Revision (Right Arrow)"
              >
                <span className="material-symbols-outlined text-[24px]">chevron_right</span>
              </button>
            )}

            {/* The Image */}
            <div
              style={{
                transform: `scale(${lightboxZoom})`,
                transition: "transform 0.15s ease-out",
              }}
              className="max-h-[75vh] max-w-full flex items-center justify-center origin-center"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getFullImageUrl(diffResult.revisions[lightboxRevisionIndex].image_url)}
                alt={`Revision ${lightboxRevisionIndex + 1}`}
                className="max-h-[75vh] max-w-full object-contain rounded-lg shadow-lg border border-hairline bg-white"
              />
            </div>
          </div>

          {/* Lightbox Footer Bar with Metadata */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-5xl bg-white border border-hairline rounded-xl px-5 py-2.5 flex flex-wrap items-center justify-between gap-2 shadow-2xl font-mono text-xs text-ink"
          >
            <div className="flex items-center gap-4 text-ink-light">
              <span>MRP: <strong className="text-ink">{diffResult.revisions[lightboxRevisionIndex].fields?.mrp || "—"}</strong></span>
              <span>Net Qty: <strong className="text-ink">{diffResult.revisions[lightboxRevisionIndex].fields?.net_quantity || "—"}</strong></span>
              <span>Verdict: <strong className="text-ink">{diffResult.revisions[lightboxRevisionIndex].verdict?.overall_result || "PASS"}</strong></span>
            </div>
            <div className="flex items-center gap-2 text-ink-light text-[11px]">
              <span>Use Left / Right arrow keys to switch revisions • Esc to close</span>
            </div>
          </div>
        </div>
      )}

      {/* Variance Evolution Audit Report Modal */}
      {diffResult && (
        <ReportModal
          isOpen={isReportModalOpen}
          onClose={() => setIsReportModalOpen(false)}
          type="variance"
          data={diffResult}
        />
      )}
    </div>
  );
};
export default VarianceStudioView;
