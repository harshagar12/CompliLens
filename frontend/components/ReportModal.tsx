"use client";

import React, { useRef, useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { generatePdfFromHtml, API_BASE_URL } from "@/lib/api";

export type ReportType = "inspection" | "variance" | "manufacturer";

export interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: ReportType;
  data: any; // Context-specific data payload
  rulesMap?: Record<string, { description: string; source_citation: string }>;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  type,
  data,
  rulesMap = {},
}) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Toggle body class so print media query cleanly hides the rest of the application
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add("report-modal-open");
    } else {
      document.body.classList.remove("report-modal-open");
    }
    return () => {
      document.body.classList.remove("report-modal-open");
    };
  }, [isOpen]);

  // Generate deterministic/consistent serial number based on type and timestamp or package id
  const reportMeta = useMemo(() => {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const timeStr = now.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const formattedDate = now.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    let prefix = "INSP";
    let entityId = "001";

    if (type === "inspection") {
      prefix = "INSP";
      const pkgId = data?.verdict?.package_id || data?.package_id || "PKG";
      entityId = pkgId.slice(0, 6).toUpperCase();
    } else if (type === "variance") {
      prefix = "VAR";
      const firstRevId = data?.revisions?.[0]?.package_id || "REV";
      entityId = firstRevId.slice(0, 6).toUpperCase();
    } else if (type === "manufacturer") {
      prefix = "MFR";
      const mfrKey = data?.manufacturer_key || "MFR";
      entityId = mfrKey.slice(0, 6).toUpperCase();
    }

    const serialNumber = `CLR-${prefix}-${dateStr}-${entityId}`;

    return {
      serialNumber,
      timestamp: `${formattedDate}, ${timeStr} IST`,
      isoDate: now.toISOString(),
      evaluationScope: "Legal Metrology (Packaged Commodities) Rules, 2011",
      systemVersion: "CompliLens Automated Compliance Engine v1.0.0",
    };
  }, [type, data]);

  if (!isOpen || !data || !mounted) return null;

  // ---------------------------------------------------------------------------
  // JSON Export Handler
  // ---------------------------------------------------------------------------
  const handleExportJson = () => {
    const exportPayload = {
      report_metadata: reportMeta,
      report_type: type,
      audit_data: data,
    };
    const jsonStr = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportMeta.serialNumber}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ---------------------------------------------------------------------------
  // Print / Native PDF Handler
  // ---------------------------------------------------------------------------
  const handlePrint = () => {
    window.print();
  };

  // ---------------------------------------------------------------------------
  // Gotenberg PDF Download with Browser Print Fallback
  // ---------------------------------------------------------------------------
  const handleDownloadPdf = async () => {
    if (!reportRef.current) {
      window.print();
      return;
    }

    setDownloadingPdf(true);
    try {
      // Gather active document stylesheets and inline them for Gotenberg
      let styleTags = "";
      for (const el of Array.from(document.querySelectorAll("style, link[rel='stylesheet']"))) {
        if (el.tagName.toLowerCase() === "style") {
          styleTags += el.outerHTML + "\n";
        } else if (el.tagName.toLowerCase() === "link") {
          try {
            const href = (el as HTMLLinkElement).href;
            if (href) {
              const res = await fetch(href);
              const cssText = await res.text();
              styleTags += `<style>\n${cssText}\n</style>\n`;
            }
          } catch (e) {
            console.warn("Failed to fetch stylesheet", e);
          }
        }
      }

      // Convert ALL images to base64 so Gotenberg (running in a container) can render them without network issues
      const clone = reportRef.current.cloneNode(true) as HTMLElement;
      const images = Array.from(clone.querySelectorAll("img"));
      for (const img of images) {
        if (img.src && !img.src.startsWith("data:")) {
          try {
            // Use getAttribute('src') for relative paths, otherwise use the resolved absolute src
            const rawSrc = img.getAttribute("src") || "";
            const srcToFetch = rawSrc.startsWith("/") ? window.location.origin + rawSrc : img.src;
            
            const res = await fetch(srcToFetch);
            const blob = await res.blob();
            const base64 = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            img.src = base64;
          } catch (e) {
            console.warn("Failed to convert image to base64", img.src, e);
          }
        }
      }

      // Build standalone printable HTML document incorporating all CSS and page settings
      const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${reportMeta.serialNumber} - Compliance Audit Report</title>
  ${styleTags}
  <style>
    @page { size: A4 portrait; margin: 12mm 10mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Public Sans", "Segoe UI", Roboto, sans-serif; color: #1B1B18; background: #FFFFFF; margin: 0; padding: 20px; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { box-sizing: border-box; }
    table { width: 100%; border-collapse: collapse; break-inside: avoid !important; page-break-inside: avoid !important; }
    th, td { padding: 6px 8px; border-bottom: 1px solid #E5E4DE; text-align: left; vertical-align: top; }
    th { font-family: monospace; font-size: 9px; text-transform: uppercase; color: #5C5C56; background: #F6F5F1; }
    .print-avoid-break, .report-card, tr, thead, tbody { break-inside: avoid !important; page-break-inside: avoid !important; }
    div[class*="border-2 border-seal"], div[class*="border border-stamp-green"], div[class*="border-2 border-dashed"] { background-color: transparent !important; }
    img { max-width: 100%; height: auto; object-contain: contain; }
  </style>
</head>
<body class="p-6 bg-white text-ink font-body">
  ${clone.innerHTML}
</body>
</html>`;

      const pdfBlob = await generatePdfFromHtml(reportHtml, `${reportMeta.serialNumber}.pdf`);
      if (pdfBlob) {
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${reportMeta.serialNumber}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        // Fallback to browser print dialog if Gotenberg is unreachable
        window.print();
      }
    } catch {
      window.print();
    } finally {
      setDownloadingPdf(false);
    }
  };

  return createPortal(
    <div
      data-report-portal="true"
      className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 md:p-6 print:p-0 print:bg-white print:static print:block print:z-auto"
    >
      {/* Container Dialog */}
      <div className="bg-white border border-hairline rounded-xl shadow-2xl max-w-5xl w-full h-[92vh] flex flex-col overflow-hidden print:h-auto print:max-h-none print:shadow-none print:border-none print:w-full print:rounded-none print:overflow-visible">
        
        {/* =================================================================== */}
        {/* Modal Action Toolbar (Hidden in Print) */}
        {/* =================================================================== */}
        <div className="px-5 py-3 border-b border-hairline bg-wash/80 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-seal text-[20px]">description</span>
            <span className="font-heading font-semibold text-sm text-ink">
              {type === "inspection" && "Statutory Compliance Audit Report"}
              {type === "variance" && "Packaging Evolution & Shrinkflation Dossier"}
              {type === "manufacturer" && "Manufacturer Compliance Fleet Audit"}
            </span>
            <span className="font-mono text-xs text-ink-light bg-white px-2 py-0.5 rounded border border-hairline">
              {reportMeta.serialNumber}
            </span>
          </div>

          <div className="flex items-center gap-2">


            {/* Direct Gotenberg PDF stream */}
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-seal hover:bg-seal-light text-white text-xs font-mono font-medium transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              title="Download formatted PDF via automated Gotenberg service"
            >
              <span className="material-symbols-outlined text-[16px]">
                {downloadingPdf ? "progress_activity" : "download"}
              </span>
              <span>{downloadingPdf ? "Generating..." : "Download PDF"}</span>
            </button>

            {/* JSON Export */}
            <button
              type="button"
              onClick={handleExportJson}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white hover:bg-wash border border-hairline text-xs font-mono text-ink-light hover:text-ink transition-colors cursor-pointer"
              title="Export complete audit dataset as structured JSON"
            >
              <span className="material-symbols-outlined text-[15px]">data_object</span>
              <span>JSON</span>
            </button>

            <div className="h-4 w-px bg-hairline mx-1" />

            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-brick-light/40 text-ink-light hover:text-brick border border-transparent hover:border-brick/30 transition-colors cursor-pointer"
              title="Close Report (Esc)"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* =================================================================== */}
        {/* Scrollable Document Body (A4 Styled, Full Height) */}
        {/* =================================================================== */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-10 space-y-6 print:overflow-visible print:p-0 print:h-auto">
          <div ref={reportRef} className="space-y-6 text-ink font-body max-w-4xl mx-auto print:max-w-none">
            
            {/* ------------------------------------------------------------- */}
            {/* FORMAL REPORT HEADER */}
            {/* ------------------------------------------------------------- */}
            <div className="border-b-2 border-seal pb-4 space-y-2 print-avoid-break">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-[10px] font-mono font-bold tracking-widest text-seal uppercase block">
                    CompliLens Packaging Intelligence System
                  </span>
                  <h1 className="text-xl sm:text-2xl font-heading font-bold text-ink tracking-tight mt-0.5">
                    {type === "inspection" && "Statutory Compliance Audit Report"}
                    {type === "variance" && "Packaging Evolution & Shrinkflation Audit Dossier"}
                    {type === "manufacturer" && "Manufacturer Compliance Fleet Audit Report"}
                  </h1>
                  <span className="text-xs text-ink-light font-mono block mt-0.5">
                    Evaluation Scope: {reportMeta.evaluationScope}
                  </span>
                </div>

                {/* Reference ID & Timestamp Box */}
                <div className="text-right font-mono text-xs shrink-0 space-y-1 bg-wash/60 p-2.5 rounded-lg border border-hairline">
                  <div>
                    <span className="text-[10px] text-ink-light uppercase block">Report Serial No.</span>
                    <span className="font-bold text-seal">{reportMeta.serialNumber}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-ink-light uppercase block">Generated At</span>
                    <span className="text-ink">{reportMeta.timestamp}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] font-mono text-ink-light border-t border-hairline">
                <span>System: {reportMeta.systemVersion}</span>
                <span>Rule Framework: LMPC Rules 2011 (as amended)</span>
                <span>Environment: Automated Audit Pipeline</span>
              </div>
            </div>

            {/* ============================================================= */}
            {/* REPORT TYPE 1: INSPECTION REPORT */}
            {/* ============================================================= */}
            {type === "inspection" && (() => {
              const verdict = data?.verdict || data;
              const fields = data?.fields || [];
              const previewUrl = data?.previewUrl || data?.imageUrl;
              const evs = (verdict?.evaluations || []) as any[];
              const isPass = verdict?.overall_result === "PASS";
              const isFail = verdict?.overall_result === "FAIL";
              const passCount = evs.filter((e) => e.result === "PASS").length;
              const failCount = evs.filter((e) => e.result === "FAIL").length;

              return (
                <div className="space-y-6">
                  {/* Executive Summary Card */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 print-avoid-break">
                    <div className={`p-4 rounded-lg border ${
                      isPass
                        ? "bg-stamp-green-light/20 border-stamp-green/40"
                        : isFail
                        ? "bg-brick-light/20 border-brick/40"
                        : "bg-ochre-light/20 border-ochre/40"
                    }`}>
                      <span className="text-[10px] font-mono font-bold uppercase text-ink-light block">
                        Statutory Audit Verdict
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xl font-heading font-bold ${
                          isPass ? "text-stamp-green-dark" : isFail ? "text-brick" : "text-ochre-dark"
                        }`}>
                          {isPass ? "COMPLIANT" : isFail ? "NON-COMPLIANT" : "UNDER REVIEW"}
                        </span>
                      </div>
                      <span className="text-[11px] text-ink-light font-mono mt-1 block">
                        {isPass
                          ? "All mandatory LMPC statutory rules verified."
                          : `${failCount} statutory violation${failCount > 1 ? "s" : ""} detected.`}
                      </span>
                    </div>

                    <div className="p-4 rounded-lg border border-hairline bg-white">
                      <span className="text-[10px] font-mono font-bold uppercase text-ink-light block">
                        Rules Compliance Breakdown
                      </span>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-xl font-mono font-bold text-ink">{passCount}/{evs.length}</span>
                        <span className="text-xs font-mono text-stamp-green-dark">Rules Passed</span>
                      </div>
                      <span className="text-[11px] text-ink-light font-mono mt-1 block">
                        {failCount > 0 ? `${failCount} Non-Compliances` : "Zero Violations"}
                      </span>
                    </div>

                    <div className="p-4 rounded-lg border border-hairline bg-white">
                      <span className="text-[10px] font-mono font-bold uppercase text-ink-light block">
                        Package Information
                      </span>
                      <div className="mt-1 font-mono text-xs space-y-0.5">
                        <div>ID: <strong className="text-ink">{verdict?.package_id || "PKG-001"}</strong></div>
                        <div className="truncate">Category: <strong className="text-ink capitalize">{verdict?.category?.replace(/_/g, " ") || "Packaged Food"}</strong></div>
                        {verdict?.exemption_applied && (
                          <div className="text-ochre-dark font-bold">Exempt: {verdict.exemption_applied}</div>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Declared Statutory Values Table */}
                  <div className="space-y-2 print-avoid-break">
                    <h2 className="text-xs font-mono font-bold text-seal uppercase tracking-wider border-b border-hairline pb-1">
                      1. Declared Statutory Metrics Summary
                    </h2>
                    <table className="w-full text-xs font-mono border border-hairline rounded-lg overflow-hidden">
                      <thead className="bg-wash text-ink-light text-[10px]">
                        <tr>
                          <th className="p-2.5">Statutory Field</th>
                          <th className="p-2.5">Declared / Extracted Text</th>
                          <th className="p-2.5 w-24">Confidence</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {[
                          { key: "common_name", label: "Commodity Name" },
                          { key: "net_quantity", label: "Net Quantity" },
                          { key: "mrp", label: "Maximum Retail Price (MRP)" },
                          { key: "mfg_month_year", label: "Month & Year of Mfg/Packing" },
                          { key: "manufacturer_name_address", label: "Manufacturer Name & Address" },
                          { key: "consumer_care", label: "Consumer Care Details" },
                        ].map((item) => {
                          const fieldObj = Array.isArray(fields) 
                            ? fields.find((f: any) => f.field_name === item.key)
                            : fields?.[item.key];
                          
                          const val = fieldObj?.confirmed_value ?? fieldObj?.raw_value ?? "—";
                          const conf = fieldObj?.confidence ? `${(fieldObj.confidence * 100).toFixed(0)}%` : "—";
                          
                          return (
                            <tr key={item.key} className="hover:bg-wash/30">
                              <td className="p-2.5 font-semibold text-ink">{item.label}</td>
                              <td className="p-2.5 text-ink break-words">{val}</td>
                              <td className="p-2.5 text-ink-light font-mono">{conf}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Packaging Visual Preview Card if available */}
                  {previewUrl && (
                    <div className="p-4 border border-hairline rounded-lg bg-white flex flex-col items-center gap-2 print-avoid-break">
                      <span className="text-[10px] text-ink-light font-bold uppercase tracking-wider block self-start">
                        Inspected Label Artwork Proof
                      </span>
                      <div className="w-full max-h-[250px] flex items-center justify-center overflow-hidden">
                        <img
                          src={previewUrl}
                          alt="Inspected Label Artwork"
                          className="max-w-full max-h-[250px] object-contain rounded"
                        />
                      </div>
                    </div>
                  )}

                  {/* Statutory Rules Audit Checklist */}
                  <div className="space-y-2 print-avoid-break">
                    <h2 className="text-xs font-mono font-bold text-seal uppercase tracking-wider border-b border-hairline pb-1">
                      2. Legal Metrology (LMPC) Rules Checklist &amp; Assessment
                    </h2>
                    <table className="w-full text-xs font-mono border border-hairline rounded-lg overflow-hidden">
                      <thead className="bg-wash text-ink-light text-[10px]">
                        <tr>
                          <th className="p-2.5 w-28">Rule ID</th>
                          <th className="p-2.5">Statutory Requirement</th>
                          <th className="p-2.5 w-24">Outcome</th>
                          <th className="p-2.5">Audit Assessment / Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {evs.map((ev: any) => {
                          const meta = rulesMap[ev.rule_id];
                          const pass = ev.result === "PASS";
                          const fail = ev.result === "FAIL";

                          return (
                            <tr key={ev.rule_id} className={fail ? "bg-brick-light/10" : ""}>
                              <td className="p-2.5">
                                <span className="font-bold text-seal">{ev.rule_id}</span>
                                {meta?.source_citation && (
                                  <span className="block text-[10px] text-ink-light font-normal">
                                    {meta.source_citation}
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 text-ink font-body">
                                <div className="font-semibold text-ink text-xs font-heading">
                                  {ev.field_name?.replace(/_/g, " ")}
                                </div>
                                <div className="text-[11px] text-ink-light mt-0.5">
                                  {meta?.description || "Mandatory declaration under LMPC Rules, 2011."}
                                </div>
                              </td>
                              <td className="p-2.5">
                                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                                  pass
                                    ? "bg-stamp-green-light/30 text-stamp-green-dark border-stamp-green/40"
                                    : fail
                                    ? "bg-brick-light/30 text-brick border-brick/40"
                                    : "bg-ochre-light/30 text-ochre-dark border-ochre/40"
                                }`}>
                                  {ev.result}
                                </span>
                              </td>
                              <td className="p-2.5 text-ink font-body text-[11px] leading-relaxed">
                                {ev.notes || (pass ? "Satisfies statutory requirement." : "Declaration missing or non-compliant.")}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Technical Perception Scope Footer */}
                  <div className="p-3 bg-wash/50 border border-hairline rounded-lg text-xs font-mono text-ink-light flex flex-wrap items-center justify-between gap-2 print-avoid-break">
                    <span>Perception Engine: RapidOCR &amp; Geometry Validator</span>
                    <span>Date Evaluated: {verdict?.evaluated_at ? new Date(verdict.evaluated_at).toLocaleString() : reportMeta.timestamp}</span>
                  </div>
                </div>
              );
            })()}

            {/* ============================================================= */}
            {/* REPORT TYPE 2: VARIANCE & EVOLUTION REPORT */}
            {/* ============================================================= */}
            {type === "variance" && (() => {
              const diff = data;
              const revs = (diff?.revisions || []) as any[];
              const shrink = diff?.shrinkflation || {};
              const comp = diff?.compliance_progression || {};
              const ing = diff?.ingredients_diff || {};
              const alg = diff?.allergens_diff || {};
              const statDiffs = diff?.statutory_diffs || [];

              const dateDiff = statDiffs.find((d: any) => d.field_name === "mfg_month_year");
              const mrpDiff = statDiffs.find((d: any) => d.field_name === "mrp");
              const qtyDiff = statDiffs.find((d: any) => d.field_name === "net_quantity");

              const highlightChips = [
                {
                  id: "mrp",
                  label: "MRP",
                  badge: mrpDiff?.changed
                    ? `${mrpDiff.values?.[0] || "—"} → ${mrpDiff.values?.slice(-1)[0] || "—"}`
                    : `${mrpDiff?.values?.[0] || "Stable"}`,
                  changed: !!mrpDiff?.changed,
                  color: shrink.mrp_delta_pct > 0 ? "brick" : "seal",
                  detail: shrink.summary || "Retail price drift across revisions.",
                },
                {
                  id: "qty",
                  label: "Net Qty",
                  badge: qtyDiff?.changed
                    ? `${qtyDiff.values?.[0] || "—"} → ${qtyDiff.values?.slice(-1)[0] || "—"}`
                    : `${qtyDiff?.values?.[0] || "Stable"}`,
                  changed: !!qtyDiff?.changed,
                  color: shrink.qty_delta_pct < 0 ? "brick" : "seal",
                  detail: shrink.summary || "Declared net content shifts across revisions.",
                },
                {
                  id: "unit_price",
                  label: "Unit Price",
                  badge: shrink.unit_price_delta_pct
                    ? `${shrink.unit_price_delta_pct > 0 ? "+" : ""}${shrink.unit_price_delta_pct}%`
                    : "0.0% Shift",
                  changed: !!shrink.unit_price_delta_pct && shrink.unit_price_delta_pct !== 0,
                  color: shrink.unit_price_delta_pct > 0 ? "brick" : "stamp-green",
                  detail: shrink.summary || "Unit economics drift.",
                },
                {
                  id: "date",
                  label: "Mfg Date",
                  badge: dateDiff?.changed
                    ? `${dateDiff.values?.[0] || "—"} → ${dateDiff.values?.slice(-1)[0] || "—"}`
                    : `${dateDiff?.values?.[0] || "Unchanged"}`,
                  changed: !!dateDiff?.changed,
                  color: "seal",
                  detail: "Manufacturing timeline progression.",
                },
                {
                  id: "recipe",
                  label: "Recipe",
                  badge: ing.substitutions?.length > 0
                    ? `${ing.substitutions.length} Swaps`
                    : ing.added?.length > 0
                    ? `+${ing.added.length} Added`
                    : "Stable",
                  changed: (ing.substitutions?.length > 0) || (ing.added?.length > 0),
                  color: ing.substitutions?.length > 0 ? "ochre" : "seal",
                  detail: "Recipe formulation declarations.",
                },
                {
                  id: "compliance",
                  label: "LMPC Rules",
                  badge: comp.regressions?.length > 0
                    ? `${comp.regressions.length} Regressed`
                    : comp.remediations?.length > 0
                    ? `+${comp.remediations.length} Resolved`
                    : "100% Compliant",
                  changed: (comp.regressions?.length > 0) || (comp.remediations?.length > 0),
                  color: comp.regressions?.length > 0 ? "brick" : "stamp-green",
                  detail: comp.regressions?.length > 0
                    ? `${comp.regressions.length} statutory regressions detected.`
                    : "All statutory requirements satisfied.",
                },
              ];

              return (
                <div className="space-y-6">
                  {/* Executive Metrics Overview */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 print-avoid-break">
                    <div className={`p-4 rounded-lg border ${
                      shrink.is_shrinkflation
                        ? "bg-brick-light/20 border-brick/40"
                        : shrink.unit_price_delta_pct > 0
                        ? "bg-ochre-light/20 border-ochre/40"
                        : "bg-paper border-hairline"
                    }`}>
                      <span className="text-[10px] font-mono font-bold uppercase text-ink-light block">
                        Shrinkflation &amp; Pricing Shift
                      </span>
                      <div className="text-xl font-mono font-bold mt-1 text-ink">
                        {shrink.unit_price_delta_pct !== undefined
                          ? `${shrink.unit_price_delta_pct > 0 ? "+" : ""}${shrink.unit_price_delta_pct}%`
                          : "0.0%"}
                      </div>
                      <span className="text-[11px] text-ink-light font-mono mt-1 block">
                        {shrink.is_shrinkflation
                          ? "STEALTH SHRINKFLATION CONFIRMED"
                          : "Unit economics stable across revisions."}
                      </span>
                    </div>

                    <div className="p-4 rounded-lg border border-hairline bg-white">
                      <span className="text-[10px] font-mono font-bold uppercase text-ink-light block">
                        Regulatory Compliance Drift
                      </span>
                      <div className="mt-1 flex items-baseline gap-2 font-mono text-xl font-bold">
                        <span className="text-stamp-green-dark">+{comp.remediations?.length || 0}</span>
                        <span className="text-xs text-ink-light">/</span>
                        <span className="text-brick">-{comp.regressions?.length || 0}</span>
                      </div>
                      <span className="text-[11px] text-ink-light font-mono mt-1 block">
                        {comp.regressions?.length > 0 ? "Regressions detected" : "No active regressions"}
                      </span>
                    </div>

                    <div className="p-4 rounded-lg border border-hairline bg-white">
                      <span className="text-[10px] font-mono font-bold uppercase text-ink-light block">
                        Lineage Revisions Evaluated
                      </span>
                      <div className="mt-1 font-mono text-xl font-bold text-seal">
                        {diff.num_revisions || revs.length} Packaging Revisions
                      </div>
                      <span className="text-[11px] text-ink-light font-mono mt-1 block">
                        Chronological trajectory comparison
                      </span>
                    </div>
                  </div>

                  {/* 1. Variance & Evolutionary Highlights Summary (Wrapping Grid, Completely Visible) */}
                  <div className="space-y-2 print-avoid-break">
                    <h2 className="text-xs font-mono font-bold text-seal uppercase tracking-wider border-b border-hairline pb-1 flex items-center justify-between">
                      <span>1. Variance &amp; Evolutionary Highlights</span>
                      <span className="text-[10px] text-ink-light font-normal">Cross-Revision Comparative Findings</span>
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                      {highlightChips.map((chip) => (
                        <div
                          key={chip.id}
                          className={`p-2.5 rounded-lg border text-xs font-mono flex flex-col justify-between ${
                            chip.color === "brick" && chip.changed
                              ? "bg-brick-light/30 border-brick/40 text-brick"
                              : chip.color === "stamp-green" && chip.changed
                              ? "bg-stamp-green-light/30 border-stamp-green/40 text-stamp-green-dark"
                              : chip.color === "ochre" && chip.changed
                              ? "bg-ochre-light/30 border-ochre/40 text-ochre-dark"
                              : "bg-wash/40 border-hairline text-ink"
                          }`}
                        >
                          <div>
                            <span className="text-[10px] text-ink-light uppercase block font-bold">{chip.label}</span>
                            <span className="font-bold text-xs mt-1 block truncate">{chip.badge}</span>
                          </div>
                          <span className="text-[9px] text-ink-light mt-1.5 line-clamp-2 leading-tight">{chip.detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 2. Connected Packaging Revision Artworks (Photos with clean outlines, no white fill) */}
                  {revs.some((r: any) => r.image_url) && (
                    <div className="space-y-2 print-avoid-break">
                      <h2 className="text-xs font-mono font-bold text-seal uppercase tracking-wider border-b border-hairline pb-1 flex items-center justify-between">
                        <span>2. Connected Packaging Revision Artworks</span>
                        <span className="text-[10px] text-ink-light font-normal">Visual Label Lineage</span>
                      </h2>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                        {revs.map((r: any, idx: number) => {
                          const isPass = r.verdict?.overall_result === "PASS";
                          const fullUrl = r.image_url?.startsWith("http")
                            ? r.image_url
                            : `${API_BASE_URL}${r.image_url}`;

                          return (
                            <div key={r.package_id || idx} className="p-2 border border-hairline rounded-lg bg-wash/10 space-y-1.5 print-avoid-break">
                              <div className="flex items-center justify-between text-[10px] font-mono font-bold">
                                <span className="text-seal">Rev {idx + 1} {idx === 0 ? "(Base)" : idx === revs.length - 1 ? "(Latest)" : ""}</span>
                                <span className={`px-1.5 py-0.2 rounded text-[9px] ${isPass ? "bg-stamp-green text-white" : "bg-brick text-white"}`}>
                                  {r.verdict?.overall_result || "PASS"}
                                </span>
                              </div>
                              <div className="aspect-[4/3] bg-white border border-hairline rounded overflow-hidden relative flex items-center justify-center">
                                {r.image_url ? (
                                  <img
                                    src={fullUrl}
                                    alt={`Revision ${idx + 1}`}
                                    className="w-full h-full object-contain"
                                  />
                                ) : (
                                  <span className="text-[10px] text-ink-light font-mono italic">No preview</span>
                                )}
                              </div>
                              <div className="text-[10px] font-mono text-ink-light truncate">
                                ID: <span className="text-ink font-semibold">{r.package_id?.slice(0, 10)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 3. Packaging Lineage Chronology Table */}
                  <div className="space-y-2 print-avoid-break">
                    <h2 className="text-xs font-mono font-bold text-seal uppercase tracking-wider border-b border-hairline pb-1">
                      3. Packaging Evolution Lineage Overview
                    </h2>
                    <table className="w-full text-xs font-mono border border-hairline rounded-lg overflow-hidden">
                      <thead className="bg-wash text-ink-light text-[10px]">
                        <tr>
                          <th className="p-2.5">Revision</th>
                          <th className="p-2.5">Package ID</th>
                          <th className="p-2.5">Commodity Name</th>
                          <th className="p-2.5">Net Qty</th>
                          <th className="p-2.5">MRP</th>
                          <th className="p-2.5">Mfg Date</th>
                          <th className="p-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {revs.map((r: any, idx: number) => {
                          const isBase = idx === 0;
                          const isLatest = idx === revs.length - 1;
                          const f = r.fields || {};
                          return (
                            <tr key={r.package_id || idx} className="hover:bg-wash/30">
                              <td className="p-2.5 font-bold text-seal">
                                Rev {idx + 1} {isBase ? "(Baseline)" : isLatest ? "(Latest)" : ""}
                              </td>
                              <td className="p-2.5 text-ink-light">{r.package_id?.slice(0, 10)}</td>
                              <td className="p-2.5 text-ink font-semibold">{f.common_name || "—"}</td>
                              <td className="p-2.5 text-ink font-bold">{f.net_quantity || "—"}</td>
                              <td className="p-2.5 text-ink font-bold">{f.mrp || "—"}</td>
                              <td className="p-2.5 text-ink">{f.mfg_month_year || "—"}</td>
                              <td className="p-2.5">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  r.verdict?.overall_result === "PASS"
                                    ? "bg-stamp-green-light/30 text-stamp-green-dark"
                                    : "bg-brick-light/30 text-brick"
                                }`}>
                                  {r.verdict?.overall_result || "PASS"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* 4. Pricing & Shrinkflation Breakdown */}
                  <div className="space-y-2 print-avoid-break">
                    <h2 className="text-xs font-mono font-bold text-seal uppercase tracking-wider border-b border-hairline pb-1">
                      4. Pricing &amp; Shrinkflation Audit
                    </h2>
                    <div className="p-4 bg-wash/40 border border-hairline rounded-lg space-y-2 text-xs font-mono">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <span className="text-[10px] text-ink-light uppercase block font-bold">MRP Drift</span>
                          <span className="text-ink font-semibold">{shrink.old_mrp || "—"} → {shrink.new_mrp || "—"}</span>
                          {shrink.mrp_delta_pct !== undefined && (
                            <span className="text-brick font-bold ml-1">({shrink.mrp_delta_pct > 0 ? "+" : ""}{shrink.mrp_delta_pct}%)</span>
                          )}
                        </div>
                        <div>
                          <span className="text-[10px] text-ink-light uppercase block font-bold">Net Quantity Shift</span>
                          <span className="text-ink font-semibold">{shrink.old_net_quantity || "—"} → {shrink.new_net_quantity || "—"}</span>
                          {shrink.qty_delta_pct !== undefined && (
                            <span className={shrink.qty_delta_pct < 0 ? "text-brick font-bold ml-1" : "text-ink ml-1"}>
                              ({shrink.qty_delta_pct > 0 ? "+" : ""}{shrink.qty_delta_pct}%)
                            </span>
                          )}
                        </div>
                        <div>
                          <span className="text-[10px] text-ink-light uppercase block font-bold">Unit Price Inflation</span>
                          <span className="text-brick font-bold text-sm">
                            {shrink.unit_price_delta_pct !== undefined ? `${shrink.unit_price_delta_pct > 0 ? "+" : ""}${shrink.unit_price_delta_pct}%` : "0.0%"}
                          </span>
                        </div>
                      </div>
                      <p className="text-ink font-body text-xs pt-1 border-t border-hairline">
                        <strong>Evaluation Finding:</strong> {shrink.summary || "No stealth shrinkflation detected."}
                      </p>
                    </div>
                  </div>

                  {/* 5. Formulation & Allergen Shifts */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print-avoid-break">
                    <div className="space-y-2">
                      <h2 className="text-xs font-mono font-bold text-seal uppercase tracking-wider border-b border-hairline pb-1">
                        5. Recipe Formulation Shifts
                      </h2>
                      <div className="p-3 bg-white border border-hairline rounded-lg space-y-2 text-xs font-mono">
                        {ing.added?.length > 0 && (
                          <div>
                            <span className="text-[10px] font-bold text-stamp-green-dark uppercase block">New Ingredients:</span>
                            <span className="text-ink">{ing.added.join(", ")}</span>
                          </div>
                        )}
                        {ing.removed?.length > 0 && (
                          <div>
                            <span className="text-[10px] font-bold text-brick uppercase block">Removed Ingredients:</span>
                            <span className="text-ink-light line-through">{ing.removed.join(", ")}</span>
                          </div>
                        )}
                        {ing.percentage_changes?.length > 0 && (
                          <div>
                            <span className="text-[10px] font-bold text-seal uppercase block">Ratio Adjustments:</span>
                            <ul className="list-disc list-inside space-y-0.5 text-ink-light">
                              {ing.percentage_changes.map((pc: any, i: number) => (
                                <li key={i}>{pc.ingredient}: {pc.change}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {(!ing.added?.length && !ing.removed?.length && !ing.percentage_changes?.length) && (
                          <span className="text-ink-light italic">Formulation declarations remained uniform.</span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h2 className="text-xs font-mono font-bold text-seal uppercase tracking-wider border-b border-hairline pb-1">
                        6. Allergen Declarations Shift
                      </h2>
                      <div className="p-3 bg-white border border-hairline rounded-lg space-y-2 text-xs font-mono">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase text-ink-light">Allergen Risk Level:</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            alg.risk_level === "HIGH" ? "bg-brick text-white" : "bg-wash text-ink-light"
                          }`}>
                            {alg.risk_level || "LOW"}
                          </span>
                        </div>
                        {alg.added?.length > 0 && (
                          <div>
                            <span className="text-[10px] font-bold text-brick uppercase block">Newly Declared Allergens:</span>
                            <span className="text-brick font-bold">{alg.added.join(", ")}</span>
                          </div>
                        )}
                        {alg.removed?.length > 0 && (
                          <div>
                            <span className="text-[10px] font-bold text-ink-light uppercase block">Dropped Allergen Warnings:</span>
                            <span className="text-ink-light line-through">{alg.removed.join(", ")}</span>
                          </div>
                        )}
                        <p className="text-[11px] font-body text-ink-light pt-1 border-t border-hairline">
                          {alg.risk_explanation || "No new allergen risks detected across revisions."}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ============================================================= */}
            {/* REPORT TYPE 3: MANUFACTURER AUDIT REPORT */}
            {/* ============================================================= */}
            {type === "manufacturer" && (() => {
              const summary = data;
              const prods = (summary?.products || []) as any[];

              const activeCompliance =
                typeof summary?.current_compliance_score === "number"
                  ? summary.current_compliance_score
                  : typeof summary?.compliance_score === "number"
                  ? summary.compliance_score
                  : typeof summary?.current_fail_rate === "number"
                  ? (1 - summary.current_fail_rate) * 100
                  : 0;

              const lifetimeCompliance =
                typeof summary?.historical_compliance_score === "number"
                  ? summary.historical_compliance_score
                  : typeof summary?.compliance_score === "number"
                  ? summary.compliance_score
                  : typeof summary?.fail_rate === "number"
                  ? (1 - summary.fail_rate) * 100
                  : 0;

              const activeRegCount =
                Array.isArray(summary?.products_with_active_regression)
                  ? summary.products_with_active_regression.length
                  : typeof summary?.active_regressions_count === "number"
                  ? summary.active_regressions_count
                  : 0;

              const currentRisk = summary?.current_risk_level || summary?.risk_level || "LOW";
              const remediationStatus = summary?.remediation_status || "NON_COMPLIANT";

              const violations =
                (summary?.current_statutory_violations?.length > 0
                  ? summary.current_statutory_violations
                  : summary?.statutory_violations_breakdown?.length > 0
                  ? summary.statutory_violations_breakdown
                  : summary?.historical_statutory_violations) || [];

              return (
                <div className="space-y-6">
                  {/* Executive Overview Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 print-avoid-break">
                    <div className="p-4 bg-white border border-hairline rounded-lg">
                      <span className="text-[10px] font-mono font-bold uppercase text-ink-light block">Total Inspected</span>
                      <div className="text-2xl font-mono font-bold text-ink mt-1">
                        {summary?.total_inspections ?? prods.length}
                      </div>
                      <span className="text-[11px] text-ink-light font-mono">
                        {summary?.product_count ?? prods.length} Products · Batches
                      </span>
                    </div>

                    <div className="p-4 bg-white border border-hairline rounded-lg">
                      <span className="text-[10px] font-mono font-bold uppercase text-ink-light block">Active Shelf Pass Rate</span>
                      <div className="text-2xl font-mono font-bold text-stamp-green-dark mt-1">
                        {activeCompliance.toFixed(1)}%
                      </div>
                      <span className="text-[11px] text-ink-light font-mono">Current Shelf Health</span>
                    </div>

                    <div className="p-4 bg-white border border-hairline rounded-lg">
                      <span className="text-[10px] font-mono font-bold uppercase text-ink-light block">Lifetime Compliance</span>
                      <div className="text-2xl font-mono font-bold text-seal mt-1">
                        {lifetimeCompliance.toFixed(1)}%
                      </div>
                      <span className="text-[11px] text-ink-light font-mono">Historical Fleet Rating</span>
                    </div>

                    <div className="p-4 bg-white border border-hairline rounded-lg">
                      <span className="text-[10px] font-mono font-bold uppercase text-ink-light block">Active Regressions</span>
                      <div className={`text-2xl font-mono font-bold mt-1 ${
                        activeRegCount > 0 ? "text-brick" : "text-stamp-green-dark"
                      }`}>
                        {activeRegCount}
                      </div>
                      <span className="text-[11px] text-ink-light font-mono">
                        {activeRegCount > 0 ? `${activeRegCount} Product(s) Regressed` : "Zero Regressions"}
                      </span>
                    </div>
                  </div>

                  {/* Manufacturer Identification */}
                  <div className="p-4 bg-wash/50 border border-hairline rounded-lg text-xs font-mono space-y-2 print-avoid-break">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <span className="text-[10px] text-ink-light uppercase block font-bold">Manufacturer Entity</span>
                        <span className="text-base font-heading font-bold text-ink">{summary?.manufacturer_name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase bg-white border border-hairline text-ink-light">
                          {remediationStatus.replace(/_/g, " ")}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded text-[11px] font-bold uppercase ${
                          currentRisk === "HIGH"
                            ? "bg-brick text-white"
                            : currentRisk === "MEDIUM" || currentRisk === "ELEVATED"
                            ? "bg-ochre-light text-ochre-dark border border-ochre/40"
                            : "bg-stamp-green-light text-stamp-green-dark border border-stamp-green/40"
                        }`}>
                          {currentRisk} RISK
                        </span>
                      </div>
                    </div>
                    {summary?.raw_name_address && (
                      <p className="text-[11px] text-ink-light font-body pt-1 border-t border-hairline leading-relaxed">
                        <strong>Registered Address:</strong> {summary.raw_name_address}
                      </p>
                    )}
                  </div>

                  {/* Recurring Systemic Violations */}
                  <div className="space-y-2 print-avoid-break">
                    <h2 className="text-xs font-mono font-bold text-seal uppercase tracking-wider border-b border-hairline pb-1">
                      1. Systemic Statutory Violations (Frequency Analysis)
                    </h2>
                    {violations.length > 0 ? (
                      <table className="w-full text-xs font-mono border border-hairline rounded-lg overflow-hidden">
                        <thead className="bg-wash text-ink-light text-[10px]">
                          <tr>
                            <th className="p-2.5 w-28">Rule ID</th>
                            <th className="p-2.5 w-28">Legal Citation</th>
                            <th className="p-2.5 w-24">Breach Count</th>
                            <th className="p-2.5 w-24">Frequency</th>
                            <th className="p-2.5">Observation Description</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                          {violations.map((v: any, vIdx: number) => (
                            <tr key={v.rule_id || vIdx} className="hover:bg-wash/30">
                              <td className="p-2.5 font-bold text-brick">{v.rule_id}</td>
                              <td className="p-2.5 text-ink-light">{v.citation || "LMPC Rules 2011"}</td>
                              <td className="p-2.5 font-bold text-ink">{v.fail_count ?? v.count ?? 0} batches</td>
                              <td className="p-2.5 text-brick font-bold">{v.percentage ?? v.frequency_pct ?? 0}%</td>
                              <td className="p-2.5 text-ink font-body text-[11px]">
                                {v.description || v.notes || "Statutory non-compliance."}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-3 bg-stamp-green-light/20 border border-stamp-green/30 rounded-lg text-xs font-mono text-stamp-green-dark">
                        ✓ No systemic or recurring statutory violations detected across packaging fleet.
                      </div>
                    )}
                  </div>

                  {/* Product Portfolio & Shelf Status Table */}
                  <div className="space-y-2 print-avoid-break">
                    <h2 className="text-xs font-mono font-bold text-seal uppercase tracking-wider border-b border-hairline pb-1">
                      2. Product Portfolio &amp; Shelf Compliance Status
                    </h2>
                    <table className="w-full text-xs font-mono border border-hairline rounded-lg overflow-hidden">
                      <thead className="bg-wash text-ink-light text-[10px]">
                        <tr>
                          <th className="p-2.5">Commodity Name</th>
                          <th className="p-2.5 w-24">Pack</th>
                          <th className="p-2.5 w-24">Status</th>
                          <th className="p-2.5">Non-Compliances</th>
                          <th className="p-2.5 w-20">Regression</th>
                          <th className="p-2.5 w-24">Trend</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {prods.map((p: any) => (
                          <tr key={p.product_key} className="hover:bg-wash/30">
                            <td className="p-2.5">
                              <div className="font-bold text-ink">{p.common_name}</div>
                              <div className="text-[10px] text-ink-light">{p.total_inspections} audits</div>
                            </td>
                            <td className="p-2.5 text-ink">{p.net_quantity || "Std"}</td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                p.latest_verdict === "PASS"
                                  ? "bg-stamp-green-light/30 text-stamp-green-dark"
                                  : p.latest_verdict === "FAIL"
                                  ? "bg-brick-light/30 text-brick"
                                  : "bg-ochre-light/30 text-ochre-dark"
                              }`}>
                                {p.latest_verdict}
                              </span>
                            </td>
                            <td className="p-2.5 text-[11px]">
                              {p.latest_failing_rules?.length > 0 ? (
                                <div className="space-y-1">
                                  {p.latest_failing_rules.map((rf: any, i: number) => (
                                    <div key={i} className="flex items-center gap-1.5 min-w-0">
                                      <span className="font-mono font-bold text-brick shrink-0">{rf.rule_id}:</span>
                                      <span className="text-ink-light font-body truncate" title={rf.notes || rf.description}>
                                        {rf.notes || rf.description || "Violation"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-stamp-green-dark font-medium font-body">✓ Compliant</span>
                              )}
                            </td>
                            <td className="p-2.5 font-mono text-[11px]">
                              {p.has_active_regression ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-brick-light text-brick">
                                  Regression
                                </span>
                              ) : (
                                <span className="text-ink-light">—</span>
                              )}
                            </td>
                            <td className="p-2.5 capitalize text-ink-light font-mono text-[11px]">
                              {p.trend?.replace(/_/g, " ").toLowerCase() || "stable"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* ------------------------------------------------------------- */}
            {/* FORMAL REPORT FOOTER (Legal Disclaimer & System Metadata) */}
            {/* ------------------------------------------------------------- */}
            <div className="pt-4 border-t border-hairline text-[10px] font-mono text-ink-light space-y-1 print-avoid-break">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>Document Reference: {reportMeta.serialNumber}</span>
                <span>CompliLens Automated Packaging Audit System</span>
              </div>
              <p className="font-body leading-relaxed text-ink-light/80">
                Notice: This report is generated by an automated multi-perception pipeline evaluating declarations under the Legal Metrology (Packaged Commodities) Rules, 2011. Designed for academic and demonstration purposes.
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
export default ReportModal;
