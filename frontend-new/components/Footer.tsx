"use client";

import React, { useEffect, useState } from "react";
import { checkHealth } from "@/lib/api";

export const Footer: React.FC = () => {
  const [dbStatus, setDbStatus] = useState<"checking" | "online" | "offline">("checking");
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    const pingDb = async () => {
      const start = performance.now();
      try {
        const data = await checkHealth();
        const duration = Math.round(performance.now() - start);
        if (isMounted) {
          if (data && data.status === "ok") {
            setDbStatus("online");
            setLatency(duration);
          } else {
            setDbStatus("offline");
            setLatency(null);
          }
        }
      } catch {
        if (isMounted) {
          setDbStatus("offline");
          setLatency(null);
        }
      }
    };

    pingDb();
    const interval = setInterval(pingDb, 15000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <footer className="w-full border-t border-hairline bg-paper mt-auto print:hidden">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-ink-light font-mono">
          {/* Left: Project info */}
          <span>
            CompliLens · MIT License · Legal Metrology (Packaged Commodities) Rules, 2011
          </span>

          {/* Right: DB status */}
          <span className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              {dbStatus === "online" && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-stamp-green opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  dbStatus === "online"
                    ? "bg-stamp-green"
                    : dbStatus === "offline"
                    ? "bg-brick"
                    : "bg-ochre"
                }`}
              />
            </span>
            <span>
              {dbStatus === "online"
                ? `PostgreSQL Active${latency !== null ? ` (${latency}ms)` : ""}`
                : dbStatus === "offline"
                ? "Database Offline"
                : "Checking…"}
            </span>
          </span>
        </div>
      </div>
    </footer>
  );
};
