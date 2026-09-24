"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface BoundingBoxField {
  id: string;
  ruleCitation: string;
  fieldLabel: string;
  extractedValue: string;
  confidence: number;
  // Percentage coordinates relative to image dimensions
  left: number;
  top: number;
  width: number;
  height: number;
  triggerDelay: number; // Seconds into scan when box activates
}

const STATUTORY_FIELDS: BoundingBoxField[] = [
  {
    id: "common_name",
    ruleCitation: "LMPC Rule 6(1)(b)",
    fieldLabel: "Commodity Name",
    extractedValue: "WHOLE WHEAT & OAT DIGESTIVE BISCUITS",
    confidence: 99,
    left: 6.2,
    top: 9.8,
    width: 32.5,
    height: 19.5,
    triggerDelay: 0.5,
  },
  {
    id: "ingredients",
    ruleCitation: "Declaration Clause",
    fieldLabel: "Ingredients & Formulation",
    extractedValue: "Atta (55%), Rolled Oats (15%), Sunflower Oil",
    confidence: 98,
    left: 6.2,
    top: 31.2,
    width: 31.2,
    height: 25.5,
    triggerDelay: 1.1,
  },
  {
    id: "net_quantity",
    ruleCitation: "LMPC Rule 6(1)(c)",
    fieldLabel: "Net Quantity",
    extractedValue: "250 g",
    confidence: 99,
    left: 62.4,
    top: 31.2,
    width: 23.2,
    height: 5.6,
    triggerDelay: 1.2,
  },
  {
    id: "mrp",
    ruleCitation: "LMPC Rule 6(1)(e)",
    fieldLabel: "Retail Sale Price (MRP)",
    extractedValue: "₹55.00 (incl. of all taxes)",
    confidence: 99,
    left: 62.4,
    top: 37.4,
    width: 23.2,
    height: 5.8,
    triggerDelay: 1.5,
  },
  {
    id: "mfg_date",
    ruleCitation: "LMPC Rule 6(1)(d)",
    fieldLabel: "Month & Year of Mfg",
    extractedValue: "03/2023",
    confidence: 97,
    left: 62.4,
    top: 43.8,
    width: 23.2,
    height: 5.0,
    triggerDelay: 1.8,
  },
  {
    id: "manufacturer",
    ruleCitation: "LMPC Rule 6(1)(a)",
    fieldLabel: "Manufacturer Name & Address",
    extractedValue: "NutriBite Foods Pvt. Ltd., Pune 411057",
    confidence: 98,
    left: 62.4,
    top: 49.5,
    width: 31.5,
    height: 9.2,
    triggerDelay: 2.1,
  },
  {
    id: "consumer_care",
    ruleCitation: "LMPC Rule 6(2)",
    fieldLabel: "Consumer Complaints Helpline",
    extractedValue: "1800-222-3333 · feedback@nutribite.com",
    confidence: 99,
    left: 62.4,
    top: 59.2,
    width: 31.5,
    height: 9.6,
    triggerDelay: 2.5,
  },
];

export const ScanAndStampHero: React.FC = () => {
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [activeBoxes, setActiveBoxes] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState<boolean>(true);
  const [isStamped, setIsStamped] = useState<boolean>(false);
  const [focusedFieldId, setFocusedFieldId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);

  // Check prefers-reduced-motion
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      setReducedMotion(true);
      setIsScanning(false);
      setActiveBoxes(new Set(STATUTORY_FIELDS.map((f) => f.id)));
      setIsStamped(true);
    }
  }, []);

  // Main scanline timeline runner
  const startScanSequence = useCallback(() => {
    if (reducedMotion) return;

    setScanProgress(0);
    setActiveBoxes(new Set());
    setIsScanning(true);
    setIsStamped(false);
    setFocusedFieldId(null);

    const totalDuration = 3200; // 3.2 seconds sweep
    const intervalTime = 20;
    const step = (intervalTime / totalDuration) * 100;

    let current = 0;
    const timer = setInterval(() => {
      current += step;
      if (current >= 100) {
        current = 100;
        clearInterval(timer);
        setScanProgress(100);
        setIsScanning(false);

        // Stamp lands 300ms after final scanline reaches bottom
        setTimeout(() => {
          setIsStamped(true);
        }, 350);
      } else {
        setScanProgress(current);

        // Activate fields as scanline sweeps past their top boundary
        STATUTORY_FIELDS.forEach((field) => {
          if (current >= field.top + 3) {
            setActiveBoxes((prev) => {
              if (prev.has(field.id)) return prev;
              const updated = new Set(prev);
              updated.add(field.id);
              return updated;
            });
          }
        });
      }
    }, intervalTime);

    return () => clearInterval(timer);
  }, [reducedMotion]);

  useEffect(() => {
    const cleanup = startScanSequence();
    return cleanup;
  }, [startScanSequence]);

  return (
    <div className="relative w-full max-w-5xl mx-auto select-none">
      {/* Container Card with Ledger Board Border and Millimeter Grid */}
      <div className="relative bg-white rounded-2xl border-2 border-hairline/80 shadow-xl overflow-hidden p-2 sm:p-4 md:p-6 bg-radial from-white via-paper/40 to-wash/60">
        
        {/* Top Control Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 sm:pb-4 mb-2 border-b border-hairline/70 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 relative">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  isScanning ? "bg-seal" : "bg-stamp-green"
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isScanning ? "bg-seal" : "bg-stamp-green"
                }`}
              />
            </span>
            <span className="font-semibold uppercase tracking-wider text-[11px] text-ink">
              {isScanning
                ? `Scanning Statutory Declarations (${Math.round(scanProgress)}%)`
                : isStamped
                ? "LMPC Statutory Audit · Verified Compliant"
                : "Finalizing Verification..."}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ink-light hidden sm:inline">
              Evidence: NutriBite Packaging Revision A
            </span>
            <button
              type="button"
              onClick={startScanSequence}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-wash hover:bg-hairline text-ink text-[11px] font-mono font-medium transition-colors cursor-pointer border border-hairline shadow-2xs"
              title="Restart scan and stamp sequence"
            >
              <span className="material-symbols-outlined text-[14px]">replay</span>
              <span>Replay Scan</span>
            </button>
          </div>
        </div>

        {/* ── Center Stage: Package Label Canvas ── */}
        <div className="relative w-full aspect-[3/2] rounded-xl overflow-hidden border border-hairline/80 shadow-md bg-paper flex items-center justify-center">
          {/* Packaging Artwork Image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero-label.png"
            alt="NutriBite Whole Wheat & Oat Digestive Biscuits Packaging Label"
            className="w-full h-full object-cover object-center block"
          />

          {/* ── Sweeping Scanline with Soft Glow ── */}
          {isScanning && !reducedMotion && (
            <div
              className="absolute left-0 right-0 z-20 pointer-events-none transition-transform duration-75 ease-linear"
              style={{ top: `${scanProgress}%` }}
            >
              {/* Thin laser line */}
              <div className="h-[2.5px] w-full bg-seal shadow-[0_0_12px_2px_rgba(43,58,85,0.7)]" />
              {/* Subtle trailing gradient glow */}
              <div className="h-16 w-full bg-gradient-to-t from-seal/20 via-seal/5 to-transparent -translate-y-full" />
            </div>
          )}

          {/* ── Dynamic Bounding Boxes ── */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
            {STATUTORY_FIELDS.map((field) => {
              const isBoxActive = activeBoxes.has(field.id);
              const isHovered = focusedFieldId === field.id;

              if (!isBoxActive) return null;

              return (
                <g key={field.id}>
                  {/* Outer glowing stroke */}
                  <rect
                    x={`${field.left}%`}
                    y={`${field.top}%`}
                    width={`${field.width}%`}
                    height={`${field.height}%`}
                    fill={isHovered ? "rgba(43, 58, 85, 0.12)" : "rgba(43, 58, 85, 0.05)"}
                    stroke="#2B3A55"
                    strokeWidth={isHovered ? "2.5" : "1.75"}
                    strokeDasharray="6 3"
                    rx="3"
                    className="transition-all duration-200"
                  />
                </g>
              );
            })}
          </svg>

          {/* ── Floating Badge Tags & Hover Hitboxes ── */}
          {STATUTORY_FIELDS.map((field) => {
            const isBoxActive = activeBoxes.has(field.id);
            const isHovered = focusedFieldId === field.id;

            return (
              <div
                key={field.id}
                onMouseEnter={() => setFocusedFieldId(field.id)}
                onMouseLeave={() => setFocusedFieldId(null)}
                className="absolute z-30 cursor-pointer"
                style={{
                  left: `${field.left}%`,
                  top: `${field.top}%`,
                  width: `${field.width}%`,
                  height: `${field.height}%`,
                }}
              >
                <AnimatePresence>
                  {isBoxActive && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className={`absolute -top-3 left-1 z-30 flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] sm:text-[9.5px] font-mono font-bold tracking-tight shadow-xs uppercase border transition-all ${
                        isHovered
                          ? "bg-seal text-white border-seal"
                          : "bg-white/95 text-seal border-seal/40 backdrop-blur-xs"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[11px] sm:text-[13px] text-stamp-green font-bold">
                        check_circle
                      </span>
                      <span className="truncate max-w-[120px] sm:max-w-[200px]">
                        {field.fieldLabel}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Hover Popover showing extracted value and citation */}
                {isHovered && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute top-full left-0 mt-1.5 z-40 bg-white/98 border border-seal/70 rounded-lg p-2.5 shadow-xl font-mono text-[11px] text-ink min-w-[220px] backdrop-blur-sm pointer-events-none"
                  >
                    <div className="flex items-center justify-between border-b border-hairline pb-1 mb-1">
                      <span className="font-bold text-seal uppercase text-[9px]">
                        {field.ruleCitation}
                      </span>
                      <span className="text-[9px] text-stamp-green-dark font-bold">
                        {field.confidence}% Match
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-ink font-body">
                      {field.extractedValue}
                    </div>
                  </motion.div>
                )}
              </div>
            );
          })}

          {/* ── The Authentic Rubber Verdict Stamp ── */}
          <AnimatePresence>
            {isStamped && (
              <motion.div
                initial={
                  reducedMotion
                    ? { opacity: 1, scale: 1, rotate: -6 }
                    : { opacity: 0, scale: 2.6, rotate: -18, y: -30 }
                }
                animate={{
                  opacity: 0.94,
                  scale: 1,
                  rotate: -6,
                  y: 0,
                }}
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 18,
                  mass: 0.9,
                }}
                className="absolute right-4 sm:right-10 bottom-6 sm:bottom-12 z-40 pointer-events-none select-none"
              >
                {/* Stamp Outer Double Rings */}
                <div className="relative border-4 border-dashed border-stamp-green rounded-2xl p-3 sm:p-4 bg-stamp-green-light/85 backdrop-blur-xs shadow-2xl flex flex-col items-center justify-center text-center rotate-[-3deg]">
                  {/* Inner fine border */}
                  <div className="border border-stamp-green/70 rounded-xl px-4 py-2 sm:px-6 sm:py-3 flex flex-col items-center">
                    <span className="font-mono text-[8px] sm:text-[10px] font-bold tracking-widest text-stamp-green uppercase block">
                      Legal Metrology Rules, 2011
                    </span>
                    <span className="font-heading font-black text-2xl sm:text-4xl text-stamp-green tracking-wider my-0.5 uppercase drop-shadow-xs">
                      PASS
                    </span>
                    <span className="font-mono text-[8px] sm:text-[9.5px] font-semibold text-stamp-green-dark uppercase tracking-wide">
                      100% Statutory Verification
                    </span>
                  </div>

                  {/* Stamp Seal Ribbon Detail */}
                  <div className="absolute -bottom-2 bg-stamp-green text-white font-mono text-[7px] sm:text-[8px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest shadow-xs">
                    Automated Verification
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Inspection Summary Bar */}
        <div className="mt-3 sm:mt-4 pt-3 border-t border-hairline/70 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-ink-light">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-ink font-medium">
              <span className="material-symbols-outlined text-seal text-[15px]">verified</span>
              <span>7 Mandatory Declarations Detected</span>
            </span>
            <span className="hidden md:inline text-hairline">|</span>
            <span className="hidden md:inline">RapidOCR Perceptual Extraction</span>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <span className="w-2 h-2 rounded-full bg-stamp-green" />
            <span className="text-stamp-green-dark font-bold uppercase tracking-wider">
              Ready for Inspector Review
            </span>
          </div>
        </div>

      </div>
    </div>
  );
};
export default ScanAndStampHero;
