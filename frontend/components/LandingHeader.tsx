"use client";

import React from "react";
import Link from "next/link";

interface LandingHeaderProps {
  onScrollToDemo?: () => void;
}

export const LandingHeader: React.FC<LandingHeaderProps> = ({ onScrollToDemo }) => {
  return (
    <header className="sticky top-0 left-0 right-0 z-50 bg-paper/90 backdrop-blur-md border-b border-hairline transition-all">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="h-16 flex items-center justify-between gap-4">
          
          {/* Logo & Identity */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="text-xl font-heading font-bold text-ink tracking-tight italic group-hover:text-seal transition-colors">
              CompliLens
            </span>
            <span className="text-[10px] font-mono text-ink-light bg-wash px-1.5 py-0.5 rounded border border-hairline/80 hidden sm:inline">
              LMPC 2011
            </span>
          </Link>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {onScrollToDemo && (
              <button
                type="button"
                onClick={onScrollToDemo}
                className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-mono font-medium text-ink-light hover:text-ink transition-colors cursor-pointer"
              >
                <span>See how it works</span>
                <span className="material-symbols-outlined text-[15px]">arrow_downward</span>
              </button>
            )}

            <Link
              href="/inspection"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-seal hover:bg-seal-light text-white text-xs font-mono font-bold tracking-tight shadow-sm hover:shadow transition-all cursor-pointer"
            >
              <span>Start an inspection</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Link>
          </div>

        </div>
      </div>
    </header>
  );
};
export default LandingHeader;
