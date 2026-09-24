"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";

type Tab = "home" | "inspect" | "queue" | "diff" | "history" | "manufacturers" | "rules";

/* ─── Animated field extraction items ─── */
const FIELDS = [
  { label: "Commodity Name", value: "Whole Wheat Digestive Biscuits", rule: "R6.1(b)", delay: 0.8 },
  { label: "Net Quantity", value: "250 g", rule: "R6.1(c)", delay: 1.2 },
  { label: "MRP", value: "₹55.00 (incl. all taxes)", rule: "R6.1(e)", delay: 1.6 },
  { label: "Manufacturer", value: "NutriBite Foods Pvt. Ltd.", rule: "R6.1(a)", delay: 2.0 },
  { label: "Best Before", value: "03/2025", rule: "R6.1(d)", delay: 2.4 },
  { label: "Consumer Care", value: "1800-222-3333", rule: "R6.2", delay: 2.8 },
];

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [showStamp, setShowStamp] = useState(false);
  const [visibleFields, setVisibleFields] = useState(0);
  const [runKey, setRunKey] = useState(0);

  const replayAnimation = useCallback(() => {
    setVisibleFields(0);
    setShowStamp(false);
    setRunKey((k) => k + 1);
  }, []);

  useEffect(() => {
    // Progressively reveal fields
    const timers = FIELDS.map((f, i) =>
      setTimeout(() => setVisibleFields(i + 1), f.delay * 1000)
    );
    // Show stamp after all fields appear
    const stampTimer = setTimeout(() => setShowStamp(true), 3400);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(stampTimer);
    };
  }, [runKey]);

  return (
    <div className="h-screen flex flex-col bg-paper text-ink font-body overflow-hidden">
      {/* ── Shared Navbar ── */}
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} reviewCount={0} />
      <div className="h-14" />

      {/* ── Split Hero ── */}
      <main className="flex-1 flex items-center overflow-hidden">
        <div className="w-full max-w-[1400px] mx-auto px-6 sm:px-8 lg:px-12 flex flex-col lg:flex-row items-center gap-10 lg:gap-16">

          {/* ──── LEFT: Text Content ──── */}
          <div className="flex-1 max-w-xl text-center lg:text-left">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 px-3 py-1 border border-hairline bg-wash text-[10px] font-mono text-ink-light uppercase tracking-wider mb-6"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-stamp-green" />
              LMPC Rules, 2011
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.1 }}
              className="text-4xl sm:text-5xl lg:text-6xl font-heading font-semibold text-ink tracking-tight leading-[1.08]"
            >
              CompliLens
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-lg sm:text-xl text-ink-light font-heading italic mt-3"
            >
              Automated Packaging Compliance
            </motion.p>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="text-sm text-ink-light mt-5 leading-relaxed max-w-md mx-auto lg:mx-0"
            >
              Upload a packaging label, extract every statutory declaration
              via OCR, and verify compliance against the Legal Metrology
              (Packaged Commodities) Rules — in seconds.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="flex flex-wrap items-center gap-3 mt-7 justify-center lg:justify-start"
            >
              <Link
                href="/inspection"
                className="inline-flex items-center gap-2 px-7 py-3 bg-seal hover:bg-seal-light text-white text-sm font-mono font-bold tracking-tight shadow-lg hover:shadow-xl transition-all cursor-pointer"
              >
                Start inspection
                <span className="material-symbols-outlined text-[17px]">arrow_forward</span>
              </Link>
            </motion.div>
          </div>

          {/* ──── RIGHT: Animated Visual Showcase ──── */}
          <motion.div
            initial={{ opacity: 0, x: 30, rotateY: -4 }}
            animate={{ opacity: 1, x: 0, rotateY: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="flex-1 max-w-lg w-full hidden md:flex flex-col max-h-[calc(100vh-8rem)]"
          >
            {/* Inspection card mockup */}
            <div className="relative bg-white border border-hairline shadow-2xl rounded-sm overflow-hidden flex-1 min-h-0 flex flex-col"
              style={{ perspective: "1200px" }}
            >
              {/* Top bar */}
              <div className="bg-seal px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
                  <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
                  <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-white/50">CompliLens · Inspection Report</span>
                  <button
                    type="button"
                    onClick={replayAnimation}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-[10px] font-mono transition-colors cursor-pointer"
                    title="Replay scan animation"
                  >
                    <span className="material-symbols-outlined text-[13px]">replay</span>
                    <span className="hidden sm:inline">Replay</span>
                  </button>
                </div>
              </div>

              {/* Content area */}
              <div className="p-3 sm:p-4 flex-1 min-h-0 overflow-hidden flex flex-col">
                {/* Image + bounding box area */}
                <div className="relative w-full aspect-[2/1] bg-wash rounded-sm mb-3 border border-hairline flex-shrink-0">
                  {/* Image with overflow hidden */}
                  <div className="absolute inset-0 overflow-hidden rounded-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/hero-label.png"
                      alt="Sample packaging label"
                      className="w-full h-full object-cover"
                    />

                    {/* Animated scan line */}
                    <motion.div
                      key={`scanline-${runKey}`}
                      initial={{ top: "0%" }}
                      animate={{ top: "100%" }}
                      transition={{ duration: 2.8, ease: "linear" }}
                      className="absolute left-0 right-0 h-[2px] bg-seal shadow-[0_0_8px_1px_rgba(43,58,85,0.5)] z-10 pointer-events-none"
                    />
                  </div>

                  {/* Bounding boxes — solid borders, colored fills, with labels */}
                  {[
                    { id: "name", idx: 1, label: "Name", top: 17, left: 15, w: 34, h: 32, color: "seal" },
                    { id: "qty", idx: 2, label: "Net Qty", top: 14, left: 58.5, w: 16.5, h: 7, color: "seal" },
                    { id: "mrp", idx: 3, label: "MRP", top: 13.5, left: 78, w: 12, h: 9, color: "seal" },
                    { id: "mfr", idx: 4, label: "Manufacturer", top: 54, left: 59, w: 29, h: 11, color: "seal" },
                    { id: "date", idx: 5, label: "Mfg Date", top: 66, left: 59, w: 20, h: 4, color: "ochre" },
                    { id: "care", idx: 6, label: "Consumer Care", top: 72, left: 59, w: 19, h: 12, color: "stamp-green" },
                  ].map((box) =>
                    visibleFields >= box.idx && (
                      <motion.div
                        key={`box-${box.id}-${runKey}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3 }}
                        className="absolute pointer-events-none"
                        style={{
                          top: `${box.top}%`,
                          left: `${box.left}%`,
                          width: `${box.w}%`,
                          height: `${box.h}%`,
                        }}
                      >
                        {/* Box border + fill */}
                        <div className={`absolute inset-0 border-2 border-${box.color} bg-${box.color}/15 rounded-sm`} />
                        {/* Label tag */}
                        <span
                          className={`absolute top-0 left-0 -translate-y-full px-1 py-px text-[7px] font-mono font-bold uppercase tracking-wider bg-${box.color} text-white rounded-sm leading-tight whitespace-nowrap`}
                        >
                          {box.label}
                        </span>
                      </motion.div>
                    )
                  )}

                  {/* Verdict stamp */}
                  {showStamp && (
                    <motion.div
                      key="verdict-stamp"
                      initial={{ opacity: 0, scale: 2.5, rotate: -20 }}
                      animate={{ opacity: 0.9, scale: 1, rotate: -6 }}
                      transition={{ type: "spring", stiffness: 350, damping: 18 }}
                      className="absolute bottom-2 right-2 z-20 pointer-events-none"
                    >
                      <div className="border-[3px] border-dashed border-stamp-green rounded-lg px-3 py-1 bg-stamp-green-light/90">
                        <span className="font-heading font-black text-lg text-stamp-green tracking-wider uppercase">
                          PASS
                        </span>
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Extracted field rows */}
                <div className="flex-1 min-h-0 overflow-auto">
                  {FIELDS.slice(0, visibleFields).map((field) => (
                    <motion.div
                      key={field.label}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25 }}
                      className="flex items-center gap-2 py-1 border-b border-hairline/60 last:border-b-0"
                    >
                      <span className="material-symbols-outlined text-[12px] text-stamp-green">check_circle</span>
                      <span className="text-[9px] font-mono text-ink-light w-20 flex-shrink-0 uppercase tracking-wider">
                        {field.rule}
                      </span>
                      <span className="text-[10px] text-ink font-medium truncate">
                        {field.label}
                      </span>
                      <span className="ml-auto text-[9px] font-mono text-ink-light truncate max-w-[130px]">
                        {field.value}
                      </span>
                    </motion.div>
                  ))}
                </div>

                {/* Bottom status bar */}
                <div className="mt-2 pt-2 border-t border-hairline flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${showStamp ? "bg-stamp-green" : "bg-seal animate-pulse"}`} />
                    <span className="text-[9px] font-mono text-ink-light">
                      {showStamp ? "Statutory audit complete" : "Scanning declarations..."}
                    </span>
                  </div>
                  {showStamp && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-[9px] font-mono font-bold text-stamp-green uppercase"
                    >
                      6/6 Verified
                    </motion.span>
                  )}
                </div>
              </div>
            </div>

            {/* Subtle shadow/reflection underneath */}
            <div className="h-4 mx-6 bg-gradient-to-b from-ink/5 to-transparent rounded-b-full" />
          </motion.div>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="flex-shrink-0 border-t border-hairline py-3.5 px-4 sm:px-6 lg:px-8">
        <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] font-mono text-ink-light">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-seal text-[15px]">account_balance</span>
            <span>SIH26034 · Ministry of Consumer Affairs, Food &amp; Public Distribution</span>
          </div>
          <span>LMPC Rules, 2011 · CompliLens v1.0.0</span>
        </div>
      </footer>
    </div>
  );
}
