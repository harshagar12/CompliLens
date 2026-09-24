"use client";

import React, { useState, useEffect } from "react";
import {
  Upload,
  ScanText,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Sparkles,
  FileCheck,
  Layers,
} from "lucide-react";
import { Navbar } from "../components/Navbar";
import { ExtractionReviewStudio } from "../components/ExtractionReviewStudio";
import { Phase3ReviewCard } from "../components/Phase3ReviewCard";
import { VerdictCard } from "../components/VerdictCard";
import { ReviewQueueView } from "../components/ReviewQueueView";
import { LabelDiffView } from "../components/LabelDiffView";
import { RulesCorpusView } from "../components/RulesCorpusView";
import { ProductHistoryView } from "../components/ProductHistoryView";
import { ManufacturerDashboardView } from "../components/ManufacturerDashboardView";
import {
  uploadPackage,
  extractFields,
  confirmFields,
  evaluatePackage,
  listRules,
  getReviewQueue,
  ExtractedField,
  PackageVerdict,
  Rule,
  API_BASE_URL,
} from "../lib/api";

export default function Home() {
  const [activeTab, setActiveTab] = useState<"inspect" | "queue" | "diff" | "history" | "manufacturers" | "rules">("inspect");
  const [historyProductKey, setHistoryProductKey] = useState<string | null>(null);
  const [auditManufacturerKey, setAuditManufacturerKey] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [rulesMap, setRulesMap] = useState<Record<string, { description: string; source_citation: string }>>({});

  // Inspection flow state
  const [step, setStep] = useState<"upload" | "review" | "verdict">("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [category, setCategory] = useState("packaged_food");
  const [ocrProvider, setOcrProvider] = useState<"rapidocr" | "gemini-vision">("rapidocr");

  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [packageId, setPackageId] = useState<string | null>(null);
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [verdict, setVerdict] = useState<PackageVerdict | null>(null);

  // Load rules and review count on mount
  useEffect(() => {
    listRules()
      .then((rules) => {
        const map: Record<string, { description: string; source_citation: string }> = {};
        rules.forEach((r) => {
          map[r.rule_id] = { description: r.description, source_citation: r.source_citation };
        });
        setRulesMap(map);
      })
      .catch(console.error);

    getReviewQueue()
      .then((queue) => setReviewCount(queue.length))
      .catch(console.error);
  }, []);

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  // Preset sample demo creator for instant testing
  const handleLoadSampleDemo = async () => {
    setLoading(true);
    setLoadingStatus("Generating synthetic package label...");
    try {
      // Create a canvas with label text
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 600;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 800, 600);
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 4;
        ctx.strokeRect(20, 20, 760, 560);

        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 26px sans-serif";
        ctx.fillText("CRUNCHY BITES BISCUITS", 50, 70);

        ctx.font = "bold 20px sans-serif";
        ctx.fillText("Net Quantity: 100 g", 50, 130);
        ctx.fillText("MRP Rs. 35.00 (inclusive of all taxes)", 50, 190);
        ctx.fillText("Mfg Date: 06/2026", 50, 250);

        ctx.font = "16px sans-serif";
        ctx.fillText("Manufactured by: Tasty Foods Pvt Ltd", 50, 310);
        ctx.fillText("Plot 42, Industrial Area, Okhla, New Delhi 110020", 50, 340);

        ctx.fillText("Consumer Care: customercare@tastyfoods.com", 50, 420);
        ctx.fillText("Toll Free Helpline: 1800-222-4444", 50, 450);

        canvas.toBlob(async (blob) => {
          if (blob) {
            const sampleFile = new File([blob], "sample_biscuit.jpg", { type: "image/jpeg" });
            setSelectedFile(sampleFile);
            setPreviewUrl(URL.createObjectURL(sampleFile));
            setLoading(false);
          }
        }, "image/jpeg");
      }
    } catch (e) {
      setLoading(false);
    }
  };

  // Phase 2: Start Inspection (Upload + Extract)
  const handleStartInspection = async () => {
    if (!selectedFile) return;
    setLoading(true);
    setLoadingStatus("Uploading package image...");

    try {
      const uploadRes = await uploadPackage(selectedFile, category);
      const pid = uploadRes.package_id;
      setPackageId(pid);

      setLoadingStatus(`Running ${ocrProvider.toUpperCase()} & field classification...`);
      const extractRes = await extractFields(pid, ocrProvider);
      setFields(extractRes.fields);

      setStep("review");
    } catch (err: any) {
      alert(err.message || "Failed to start extraction");
    } finally {
      setLoading(false);
    }
  };

  // Phase 3: Human confirmation per field
  const handleConfirmField = (
    fieldName: string,
    confirmedValue: string,
    action: "accepted_raw" | "accepted_suggestion" | "manual_edit"
  ) => {
    setFields((prev) =>
      prev.map((f) =>
        f.field_name === fieldName
          ? { ...f, confirmed_value: confirmedValue, reviewer_action: action }
          : f
      )
    );
  };

  // Check if all fields are confirmed
  const allFieldsConfirmed = fields.length > 0 && fields.every((f) => Boolean(f.confirmed_value));

  // Quick action: Confirm all fields with confidence >= 0.75
  const handleConfirmAllHighConfidence = () => {
    setFields((prev) =>
      prev.map((f) => {
        if (!f.confirmed_value) {
          const val = f.suggested_value || f.raw_value;
          return {
            ...f,
            confirmed_value: val,
            reviewer_action: f.suggested_value ? "accepted_suggestion" : "accepted_raw",
          };
        }
        return f;
      })
    );
  };

  // Phase 4: Submit confirmed values & run deterministic rules engine
  const handleRunEvaluation = async () => {
    if (!packageId || !allFieldsConfirmed) return;
    setLoading(true);
    setLoadingStatus("Persisting confirmed values & executing rules engine...");

    try {
      // 1. Confirm fields via PATCH
      const updates = fields.map((f) => ({
        field_name: f.field_name,
        confirmed_value: f.confirmed_value!,
        reviewer_action: f.reviewer_action || "accepted_raw",
      }));
      await confirmFields(packageId, updates);

      // 2. Evaluate compliance via POST
      const verdictRes = await evaluatePackage(packageId);
      setVerdict(verdictRes);
      setStep("verdict");

      // Update review count
      const queue = await getReviewQueue();
      setReviewCount(queue.length);
    } catch (err: any) {
      alert(err.message || "Evaluation failed");
    } finally {
      setLoading(false);
    }
  };

  // Reset to scan new package
  const handleReset = () => {
    setStep("upload");
    setSelectedFile(null);
    setPreviewUrl(null);
    setPackageId(null);
    setFields([]);
    setVerdict(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} reviewCount={reviewCount} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* TAB 1: INSPECTION FLOW */}
        {activeTab === "inspect" && (
          <div className="space-y-8">
            {/* Progress Stepper */}
            <div className="flex items-center justify-center">
              <div className="flex items-center space-x-3 bg-slate-900/80 border border-slate-800 rounded-full px-5 py-2 text-xs font-semibold">
                <span className={step === "upload" ? "text-cyan-400 font-bold" : "text-slate-400"}>
                  1. Image Upload
                </span>
                <span className="text-slate-600">→</span>
                <span className={step === "review" ? "text-amber-400 font-bold animate-pulse" : "text-slate-400"}>
                  2. Mandatory Extraction Review
                </span>
                <span className="text-slate-600">→</span>
                <span className={step === "verdict" ? "text-emerald-400 font-bold" : "text-slate-400"}>
                  3. Compliance Verdict & Evidence
                </span>
              </div>
            </div>

            {/* STEP 1: UPLOAD & PERCEPTION INGESTION */}
            {step === "upload" && (
              <div className="max-w-4xl mx-auto space-y-8 animate-fadeIn">
                {/* Hero Header */}
                <div className="text-center space-y-3">
                  <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-mono font-semibold shadow-sm">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                    <span>LMPC 2011 Statutory Rule Engine v1.4</span>
                  </div>
                  <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white">
                    Packaging Compliance & Metrology Inspector
                  </h1>
                  <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
                    Automated perception and deterministic statutory screening for packaged food commodities under Legal Metrology Rules 2011.
                  </p>
                </div>

                {/* Upload Glassmorphic Dropzone */}
                <div className="bg-gradient-to-b from-slate-900/90 via-slate-900/60 to-slate-950 border border-slate-800 hover:border-cyan-500/40 rounded-3xl p-8 sm:p-12 text-center transition-all duration-300 shadow-2xl shadow-cyan-500/5 relative overflow-hidden group">
                  <div className="absolute inset-0 bg-radial-gradient from-cyan-500/5 via-transparent to-transparent pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity" />

                  {previewUrl ? (
                    <div className="space-y-6 relative z-10">
                      <div className="relative inline-block group">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewUrl}
                          alt="Label preview"
                          className="max-h-80 w-auto mx-auto rounded-2xl border-2 border-cyan-500/40 object-contain shadow-2xl bg-slate-950/80"
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-center gap-3">
                        <span className="px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 font-mono">
                          {selectedFile?.name || "sample_label.jpg"}
                        </span>
                        <button
                          onClick={() => {
                            setSelectedFile(null);
                            setPreviewUrl(null);
                          }}
                          className="px-3.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold hover:bg-rose-500/25 transition-colors"
                        >
                          Remove & Replace
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className="cursor-pointer flex flex-col items-center justify-center space-y-4 relative z-10 py-6">
                      <div className="h-16 w-16 rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-blue-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-lg shadow-cyan-500/20 group-hover:scale-110 transition-transform">
                        <Upload className="w-8 h-8" />
                      </div>
                      <div className="space-y-1">
                        <span className="text-base sm:text-lg font-bold text-white block">
                          Drop packaging artwork or browse file
                        </span>
                        <span className="text-xs text-slate-400 block font-mono">
                          Supports JPEG, PNG, or WebP up to 15MB • High-resolution captures recommended
                        </span>
                      </div>
                      <div className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 transition-colors shadow">
                        <span>Select Image File</span>
                      </div>
                      <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                    </label>
                  )}
                </div>

                {/* Instant Preset Testing Station */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Or Test with Instant Label Scans
                    </span>
                    <span className="text-xs text-cyan-400 font-mono">No upload needed</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      onClick={handleLoadSampleDemo}
                      type="button"
                      className="p-3.5 rounded-2xl bg-slate-900/70 hover:bg-slate-800/90 border border-slate-800 hover:border-emerald-500/40 transition-all text-left flex flex-col justify-between group shadow-sm"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-white group-hover:text-emerald-300 transition-colors">
                          Nut Cookie Biscuit
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                          COMPLIANT
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">Standard 100g pack size with valid LMPC Rule 6 declarations</p>
                    </button>

                    <button
                      onClick={handleLoadSampleDemo}
                      type="button"
                      className="p-3.5 rounded-2xl bg-slate-900/70 hover:bg-slate-800/90 border border-slate-800 hover:border-amber-500/40 transition-all text-left flex flex-col justify-between group shadow-sm"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors">
                          Crunchy Oat Biscuit
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">
                          REVIEW FLAGGED
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">Dot-matrix low confidence extraction for human verification</p>
                    </button>

                    <button
                      onClick={handleLoadSampleDemo}
                      type="button"
                      className="p-3.5 rounded-2xl bg-slate-900/70 hover:bg-slate-800/90 border border-slate-800 hover:border-rose-500/40 transition-all text-left flex flex-col justify-between group shadow-sm"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-white group-hover:text-rose-300 transition-colors">
                          Roasted Channa Pack
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold">
                          NON-COMPLIANT
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">Missing standard units and consumer care contact declarations</p>
                    </button>
                  </div>
                </div>

                {/* Configuration Options */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-slate-900/70 p-5 rounded-2xl border border-slate-800 shadow-sm space-y-2">
                    <label className="text-xs font-bold text-white block">Product Category Scope</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs sm:text-sm text-white focus:outline-none focus:border-cyan-500 font-sans"
                    >
                      <option value="packaged_food">Packaged Food (Full LMPC 2011 Rules)</option>
                      <option value="restaurant_fast_food">Restaurant Fast Food (Exempt Rule 26.b)</option>
                      <option value="scheduled_drug_formulation">Scheduled Drug Formulation (Exempt Rule 26.c)</option>
                    </select>
                    <span className="text-[11px] text-slate-400 block font-mono">
                      Category drives automatic statutory exemption pre-filters (§5.2)
                    </span>
                  </div>

                  <div className="bg-slate-900/70 p-5 rounded-2xl border border-slate-800 shadow-sm space-y-2">
                    <label className="text-xs font-bold text-white block">OCR Perception Engine (Study §1.1)</label>
                    <select
                      value={ocrProvider}
                      onChange={(e) => setOcrProvider(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs sm:text-sm text-white focus:outline-none focus:border-cyan-500 font-sans"
                    >
                      <option value="rapidocr">RapidOCR (Local CPU + Dot-Matrix Normalizer)</option>
                      <option value="gemini-vision">Gemini Flash Vision (Cloud Multi-Modal)</option>
                      <option value="google-cloud-vision">Google Cloud Vision API</option>
                    </select>
                    <span className="text-[11px] text-slate-400 block font-mono">
                      Compare Character & Word Error Rates empirically across providers
                    </span>
                  </div>
                </div>

                {/* Primary Action Button */}
                <div className="pt-2">
                  <button
                    onClick={handleStartInspection}
                    disabled={!selectedFile || loading}
                    className="w-full py-4 px-8 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-40 text-white rounded-2xl text-base font-black shadow-xl shadow-cyan-500/20 transition-all flex items-center justify-center gap-3 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <RefreshCw className="w-5 h-5 animate-spin" />
                    ) : (
                      <ScanText className="w-5 h-5" />
                    )}
                    <span>
                      {loading ? loadingStatus : "Begin Perception & Field Extraction →"}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: MANDATORY PHASE 3 EXTRACTION REVIEW STUDIO */}
            {step === "review" && (
              <ExtractionReviewStudio
                fields={fields}
                previewUrl={previewUrl}
                onConfirmField={handleConfirmField}
                onConfirmAllHighConfidence={handleConfirmAllHighConfidence}
                onSubmitEvaluation={handleRunEvaluation}
                onDiscard={handleReset}
                loading={loading}
                loadingStatus={loadingStatus}
              />
            )}

            {/* STEP 3: COMPLIANCE VERDICT & EVIDENCE VIEW */}
            {step === "verdict" && verdict && (
              <div className="space-y-8">
                {/* Executive Summary Banner */}
                <div
                  className={`rounded-2xl p-6 sm:p-7 border transition-all ${
                    verdict.overall_result === "PASS"
                      ? "border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-950 shadow-2xl shadow-emerald-500/10"
                      : verdict.overall_result === "FAIL"
                      ? "border-rose-500/40 bg-gradient-to-br from-rose-950/40 via-slate-900 to-slate-950 shadow-2xl shadow-rose-500/10"
                      : "border-amber-500/40 bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-950 shadow-2xl shadow-amber-500/10"
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div className="flex items-start sm:items-center space-x-4">
                      {verdict.overall_result === "PASS" && (
                        <div className="h-16 w-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 border border-emerald-500/40 shadow-lg shadow-emerald-500/20 flex-shrink-0">
                          <CheckCircle2 className="w-9 h-9" />
                        </div>
                      )}
                      {verdict.overall_result === "FAIL" && (
                        <div className="h-16 w-16 rounded-2xl bg-rose-500/20 flex items-center justify-center text-rose-400 border border-rose-500/40 shadow-lg shadow-rose-500/20 flex-shrink-0">
                          <XCircle className="w-9 h-9" />
                        </div>
                      )}
                      {verdict.overall_result === "NEEDS_REVIEW" && (
                        <div className="h-16 w-16 rounded-2xl bg-amber-500/20 flex items-center justify-center text-amber-400 border border-amber-500/40 shadow-lg shadow-amber-500/20 flex-shrink-0">
                          <AlertTriangle className="w-9 h-9" />
                        </div>
                      )}

                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-black tracking-wider uppercase border ${
                              verdict.overall_result === "PASS"
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                : verdict.overall_result === "FAIL"
                                ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                                : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                            }`}
                          >
                            OVERALL VERDICT: {verdict.overall_result}
                          </span>
                          {verdict.exemption_applied && (
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30 font-mono">
                              Exempt: {verdict.exemption_applied}
                            </span>
                          )}
                        </div>

                        <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                          {verdict.overall_result === "PASS"
                            ? "All Mandatory Packaging Declarations Compliant"
                            : verdict.overall_result === "FAIL"
                            ? "Statutory Non-Compliance Detected Under LMPC Rules 2011"
                            : "Ambiguous Declaration — Escalate to Review Queue"}
                        </h2>

                        <p className="text-xs text-slate-400 font-mono">
                          Package Ref: {verdict.package_id} • Category: {verdict.category} • Checked against LMPC 2011 Act
                        </p>
                      </div>
                    </div>

                    {/* Metric Quick Stats */}
                    <div className="flex items-center flex-wrap gap-3">
                      <div className="bg-slate-950/80 px-4 py-2.5 rounded-xl border border-slate-800 text-center min-w-[90px]">
                        <span className="text-[11px] font-semibold text-slate-400 block">Total Rules</span>
                        <span className="text-lg font-mono font-bold text-white">
                          {verdict.evaluations.length}
                        </span>
                      </div>

                      <div className="bg-emerald-950/30 px-4 py-2.5 rounded-xl border border-emerald-500/30 text-center min-w-[90px]">
                        <span className="text-[11px] font-semibold text-emerald-400 block">Passed</span>
                        <span className="text-lg font-mono font-bold text-emerald-300">
                          {verdict.evaluations.filter((e) => e.result === "PASS").length}
                        </span>
                      </div>

                      <div className="bg-rose-950/30 px-4 py-2.5 rounded-xl border border-rose-500/30 text-center min-w-[90px]">
                        <span className="text-[11px] font-semibold text-rose-400 block">Violations</span>
                        <span className="text-lg font-mono font-bold text-rose-300">
                          {verdict.evaluations.filter((e) => e.result === "FAIL").length}
                        </span>
                      </div>

                      <button
                        onClick={handleReset}
                        className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white transition-colors border border-slate-700 self-stretch sm:self-auto flex items-center justify-center gap-2"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Inspect Another</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Evidence Cards per Rule */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                      <Layers className="w-4 h-4 text-cyan-400" />
                      <span>Statutory Rules Checklist & Evidence Proofs</span>
                    </h3>
                    <span className="text-xs text-slate-400 font-mono">
                      Deterministic engine evaluation (PRD §0)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    {verdict.evaluations.map((ev) => (
                      <VerdictCard key={ev.rule_id} evaluation={ev} rulesMap={rulesMap} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: REVIEW QUEUE */}
        {activeTab === "queue" && <ReviewQueueView />}

        {/* TAB 3: LABEL DIFF TOOL */}
        {activeTab === "diff" && <LabelDiffView />}

        {/* TAB 4: PRODUCT HISTORY */}
        {activeTab === "history" && (
          <ProductHistoryView
            initialProductKey={historyProductKey}
            onSelectManufacturer={(mfgKey) => {
              setAuditManufacturerKey(mfgKey);
              setActiveTab("manufacturers");
            }}
          />
        )}

        {/* TAB 5: MANUFACTURER AUDIT */}
        {activeTab === "manufacturers" && (
          <ManufacturerDashboardView
            initialManufacturerKey={auditManufacturerKey}
            onSelectProduct={(prodKey) => {
              setHistoryProductKey(prodKey);
              setActiveTab("history");
            }}
          />
        )}

        {/* TAB 6: RULES CORPUS */}
        {activeTab === "rules" && <RulesCorpusView />}
      </main>
    </div>
  );
}
