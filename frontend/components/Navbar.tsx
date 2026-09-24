"use client";

import React from "react";
import {
  ShieldCheck,
  ScanText,
  GitCompare,
  ClipboardList,
  BookOpen,
  History,
  Building2,
  Database,
  Sparkles,
} from "lucide-react";

interface NavbarProps {
  activeTab: "inspect" | "queue" | "diff" | "history" | "manufacturers" | "rules";
  setActiveTab: (tab: "inspect" | "queue" | "diff" | "history" | "manufacturers" | "rules") => void;
  reviewCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab, reviewCount }) => {
  return (
    <header className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-xl sticky top-0 z-50 transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
        {/* Brand Logo & System Status */}
        <div
          className="flex items-center space-x-3.5 cursor-pointer group"
          onClick={() => setActiveTab("inspect")}
        >
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/25 group-hover:scale-105 transition-transform">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xl font-black tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                CompliLens
              </span>
              <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                v1.4 LMPC
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono tracking-tight">
              Automated Legal Metrology & Packaging Compliance
            </p>
          </div>
        </div>

        {/* Segmented Navigation Bar */}
        <nav className="hidden md:flex items-center p-1 bg-slate-900/80 border border-slate-800/80 rounded-2xl shadow-inner">
          <button
            onClick={() => setActiveTab("inspect")}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === "inspect"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm shadow-cyan-500/10"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <ScanText className="w-3.5 h-3.5" />
            <span>Inspection</span>
          </button>

          <button
            onClick={() => setActiveTab("diff")}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === "diff"
                ? "bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm shadow-blue-500/10"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" />
            <span>Variance Studio</span>
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === "history"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-500/10"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Product History</span>
          </button>

          <button
            onClick={() => setActiveTab("manufacturers")}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === "manufacturers"
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm shadow-purple-500/10"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Manufacturer Audit</span>
          </button>

          <button
            onClick={() => setActiveTab("queue")}
            className={`relative flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === "queue"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm shadow-amber-500/10"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <ClipboardList className="w-3.5 h-3.5" />
            <span>Review Queue</span>
            {reviewCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-black rounded-full bg-amber-500 text-slate-950">
                {reviewCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("rules")}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === "rules"
                ? "bg-slate-800 text-slate-100 border border-slate-700"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>LMPC Rules</span>
          </button>
        </nav>

        {/* Database Live Status Indicator */}
        <div className="hidden lg:flex items-center space-x-2.5 bg-slate-900/60 px-3 py-1.5 rounded-xl border border-slate-800/90 text-xs">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-slate-400 font-mono text-[11px]">PostgreSQL 5433 • Online</span>
        </div>
      </div>
    </header>
  );
};
