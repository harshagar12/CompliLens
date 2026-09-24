"use client";

import React, { useState, useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { IngestionView } from "@/components/IngestionView";
import { ExtractionReviewStudio } from "@/components/ExtractionReviewStudio";
import { VerdictCard } from "@/components/VerdictCard";
import { ReviewQueueView } from "@/components/ReviewQueueView";
import { VarianceStudioView } from "@/components/VarianceStudioView";
import { RulesCorpusView } from "@/components/RulesCorpusView";
import { ProductHistoryView } from "@/components/ProductHistoryView";
import { ManufacturerAuditView } from "@/components/ManufacturerAuditView";
import { ComplianceReportView } from "@/components/ComplianceReportView";
import { Footer } from "@/components/Footer";
import {
  uploadPackage,
  extractFields,
  confirmFields,
  evaluatePackage,
  getReviewQueue,
  listRules,
  ExtractedField,
  PackageVerdict,
  Rule,
  API_BASE_URL,
} from "@/lib/api";

type Tab = "home" | "inspect" | "queue" | "diff" | "history" | "manufacturers" | "rules";
type Step = "upload" | "review" | "verdict";

export default function Home() {
  // ── Global navigation ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>("inspect");
  const [historyProductKey, setHistoryProductKey] = useState<string | null>(null);
  const [auditManufacturerKey, setAuditManufacturerKey] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [rulesMap, setRulesMap] = useState<Record<string, { description: string; source_citation: string }>>({});

  // ── Inspect tab state ──────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [category, setCategory] = useState("packaged_food");
  const [ocrProvider, setOcrProvider] = useState<string>("rapidocr");

  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [packageId, setPackageId] = useState<string | null>(null);
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [verdict, setVerdict] = useState<PackageVerdict | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── On mount: load rules & review count ───────────────────────────────────
  useEffect(() => {
    listRules()
      .then((rules: Rule[]) => {
        const map: Record<string, { description: string; source_citation: string }> = {};
        rules.forEach((r) => { map[r.rule_id] = { description: r.description, source_citation: r.source_citation }; });
        setRulesMap(map);
      })
      .catch(console.error);

    getReviewQueue()
      .then((q) => setReviewCount(Array.isArray(q) ? q.length : 0))
      .catch(console.error);
  }, []);

  // ── File handler ───────────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  // ── Sample label generator ─────────────────────────────────────────────────
  const handleLoadSample = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800; canvas.height = 600;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 800, 600);
    ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 4;
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
    canvas.toBlob((blob) => {
      if (blob) {
        const sampleFile = new File([blob], "sample_biscuit.jpg", { type: "image/jpeg" });
        setSelectedFile(sampleFile);
        setPreviewUrl(URL.createObjectURL(sampleFile));
      }
    }, "image/jpeg");
  };

  // ── Phase 1 → 2: Upload + Extract ─────────────────────────────────────────
  const handleStartInspection = async () => {
    if (!selectedFile) return;
    setLoading(true);
    setErrorMessage(null);
    setLoadingStatus("Uploading package image...");
    try {
      const uploadRes = await uploadPackage(selectedFile, category);
      const pid = uploadRes.package_id;
      setPackageId(pid);

      // Use backend image URL as preview (serves from /static/uploads/)
      if (uploadRes.image_url) {
        setPreviewUrl(`${API_BASE_URL}${uploadRes.image_url}`);
      }

      setLoadingStatus(`Running ${ocrProvider.toUpperCase()} & field classification...`);
      const extractRes = await extractFields(pid, ocrProvider);
      setFields(extractRes.fields || []);
      setStep("review");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to start extraction");
    } finally {
      setLoading(false);
    }
  };

  // ── Phase 2: Per-field confirm ─────────────────────────────────────────────
  const handleConfirmField = (
    fieldName: string,
    confirmedValue: string,
    action: "accepted_raw" | "accepted_suggestion" | "manual_edit"
  ) => {
    setFields((prev) =>
      prev.map((f) =>
        f.field_name === fieldName ? { ...f, confirmed_value: confirmedValue, reviewer_action: action } : f
      )
    );
  };

  const handleConfirmAllHighConfidence = () => {
    setFields((prev) =>
      prev.map((f) => {
        if (!f.confirmed_value) {
          const val = f.suggested_value || f.raw_value;
          return { ...f, confirmed_value: val, reviewer_action: f.suggested_value ? "accepted_suggestion" : "accepted_raw" };
        }
        return f;
      })
    );
  };

  const allFieldsConfirmed = fields.length > 0 && fields.every((f) => Boolean(f.confirmed_value));

  // ── Phase 3: Confirm + Evaluate ────────────────────────────────────────────
  const handleRunEvaluation = async () => {
    if (!packageId || !allFieldsConfirmed) return;
    setLoading(true);
    setLoadingStatus("Persisting confirmed values & executing rules engine...");
    try {
      const updates = fields.map((f) => ({
        field_name: f.field_name,
        confirmed_value: f.confirmed_value!,
        reviewer_action: f.reviewer_action || "accepted_raw",
      }));
      await confirmFields(packageId, updates);
      const verdictRes = await evaluatePackage(packageId);
      setVerdict(verdictRes);
      setStep("verdict");

      // Refresh review count
      const queue = await getReviewQueue();
      setReviewCount(Array.isArray(queue) ? queue.length : 0);
    } catch (err: any) {
      setErrorMessage(err.message || "Evaluation failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Reset ──────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setStep("upload");
    setSelectedFile(null);
    setPreviewUrl(null);
    setPackageId(null);
    setFields([]);
    setVerdict(null);
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen bg-surface-container-lowest text-on-surface flex flex-col">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        reviewCount={reviewCount}
      />

      <main className="flex-1 w-full px-4 sm:px-8 lg:px-12 pt-20 pb-6">

        {/* ── TAB 1: INSPECTION FLOW ── */}
        {activeTab === "inspect" && (
          <div className="space-y-8">

            {/* Error Banner */}
            {errorMessage && (
              <div className="max-w-4xl mx-auto p-4 rounded-xl bg-error/15 border border-error/30 text-error font-mono text-xs flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">error</span>
                <span>{errorMessage}</span>
                <button onClick={() => setErrorMessage(null)} className="ml-auto text-error/60 hover:text-error">✕</button>
              </div>
            )}

            {/* ── STEP 1: UPLOAD ── */}
            {step === "upload" && (
              <IngestionView
                selectedFile={selectedFile}
                previewUrl={previewUrl}
                category={category}
                ocrProvider={ocrProvider}
                loading={loading}
                loadingStatus={loadingStatus}
                onFileChange={handleFileChange}
                onLoadSample={handleLoadSample}
                onClearFile={() => { setSelectedFile(null); setPreviewUrl(null); }}
                onCategoryChange={setCategory}
                onOcrChange={setOcrProvider}
                onStartInspection={handleStartInspection}
              />
            )}

            {/* ── STEP 2: EXTRACTION REVIEW ── */}
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

            {/* ── STEP 3: COMPLIANCE VERDICT ── */}
            {step === "verdict" && verdict && (
              <ComplianceReportView
                verdict={verdict}
                fields={fields}
                onReset={handleReset}
                imageUrl={previewUrl}
              />
            )}
          </div>
        )}

        {/* ── TAB 2: REVIEW QUEUE ── */}
        {activeTab === "queue" && <ReviewQueueView />}

        {/* ── TAB 3: VARIANCE STUDIO ── */}
        {activeTab === "diff" && <VarianceStudioView />}

        {/* ── TAB 4: PRODUCT HISTORY ── */}
        {activeTab === "history" && (
          <ProductHistoryView
            initialProductKey={historyProductKey}
            onSelectManufacturer={(mfgKey) => {
              setAuditManufacturerKey(mfgKey);
              setActiveTab("manufacturers");
            }}
          />
        )}

        {/* ── TAB 5: MANUFACTURER AUDIT ── */}
        {activeTab === "manufacturers" && (
          <ManufacturerAuditView
            initialManufacturerKey={auditManufacturerKey}
            onSelectProduct={(prodKey) => {
              setHistoryProductKey(prodKey);
              setActiveTab("history");
            }}
          />
        )}

        {/* ── TAB 6: RULES CORPUS ── */}
        {activeTab === "rules" && <RulesCorpusView />}
      </main>

      {/* Footer with statutory license & DB status */}
      <Footer />
    </div>
  );
}
