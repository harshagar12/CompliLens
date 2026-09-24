"use client";

import React, { useState, useEffect } from "react";
import { getReviewQueue, submitReviewDecision, API_BASE_URL } from "@/lib/api";

export const ReviewQueueView: React.FC = () => {
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeItem, setActiveItem] = useState<any | null>(null);
  const [decision, setDecision] = useState<"APPROVE" | "OVERRIDE_PASS" | "OVERRIDE_FAIL">("APPROVE");
  const [reviewerName, setReviewerName] = useState("Inspector Sharma");
  const [reviewerNote, setReviewerNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const items = await getReviewQueue();
      setQueue(Array.isArray(items) ? items : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadQueue(); }, []);

  const handleDecisionSubmit = async () => {
    if (!activeItem?.evaluation_id) return;
    setSubmitting(true);
    try {
      await submitReviewDecision(activeItem.evaluation_id, {
        decision,
        reviewer: reviewerName,
        note: reviewerNote,
      });
      setActiveItem(null);
      setReviewerNote("");
      await loadQueue();
    } catch {
      alert("Failed to submit decision");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-semibold text-ink tracking-tight">
            Review queue
          </h1>
          <p className="text-sm text-ink-light mt-0.5">
            Cases where statutory rule logic flagged ambiguous exception conditions or partial compliance.
          </p>
        </div>
        <button
          onClick={loadQueue}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-hairline bg-paper hover:bg-wash text-ink transition-colors self-start sm:self-auto cursor-pointer"
        >
          <span className={`material-symbols-outlined text-[14px] ${loading ? "animate-spin" : ""}`}>refresh</span>
          <span>Refresh</span>
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-ink-light text-sm">
          <span className="material-symbols-outlined text-[28px] animate-spin block mb-2 text-ink-light">progress_activity</span>
          Loading review items…
        </div>
      ) : queue.length === 0 ? (
        <div className="border border-hairline rounded-lg p-12 text-center bg-white">
          <p className="text-sm text-ink-light">
            ✓ No pending cases. All evaluations are deterministically resolved.
          </p>
        </div>
      ) : (
        <div className="border border-hairline rounded-lg overflow-hidden divide-y divide-hairline">
          {queue.map((item) => (
            <div
              key={item.evaluation_id}
              className="py-4 px-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-wash/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <span className="font-mono text-sm font-semibold text-ink">{item.rule_id}</span>
                  <span className="text-xs text-ink-light font-mono">
                    Pkg: {item.package_id?.slice(0, 8)}…
                  </span>
                  <span className="text-xs text-ink-light">
                    · {(item.field_name || "").replace(/_/g, " ")}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 text-xs">
                  <span className="text-ink font-mono">
                    Value: &ldquo;{item.extracted_value || "(empty)"}&rdquo;
                  </span>
                </div>
                {item.notes && (
                  <p className="text-xs text-ochre mt-1">{item.notes}</p>
                )}
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                {item.evidence_crop_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={item.evidence_crop_url.startsWith("http") ? item.evidence_crop_url : `${API_BASE_URL}${item.evidence_crop_url}`}
                    alt="Evidence crop"
                    className="h-10 max-w-[120px] object-contain rounded border border-hairline bg-white hidden md:block"
                  />
                )}
                <button
                  onClick={() => { setActiveItem(item); setDecision("APPROVE"); }}
                  className="px-3 py-1.5 rounded-md bg-seal text-white text-xs font-medium cursor-pointer whitespace-nowrap"
                >
                  Triage →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Triage Modal */}
      {activeItem && (
        <div className="fixed inset-0 bg-ink/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-hairline rounded-lg max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-hairline">
              <h3 className="text-base font-heading font-semibold text-ink">
                Inspector decision — {activeItem.rule_id}
              </h3>
              <button onClick={() => setActiveItem(null)} className="text-ink-light hover:text-ink text-xs cursor-pointer">
                Cancel
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-ink block mb-1">Inspector name</label>
                <input
                  type="text"
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  className="w-full bg-paper border border-hairline rounded-md p-2 text-sm text-ink focus:outline-none focus:border-seal font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-ink block mb-1">Decision</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "APPROVE" as const, label: "Confirm finding" },
                    { key: "OVERRIDE_PASS" as const, label: "Override Pass" },
                    { key: "OVERRIDE_FAIL" as const, label: "Override Fail" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDecision(key)}
                      className={`p-2.5 rounded-md border text-xs font-medium transition-all cursor-pointer ${
                        decision === key
                          ? key === "OVERRIDE_FAIL"
                            ? "bg-brick-light border-brick text-brick"
                            : key === "OVERRIDE_PASS"
                            ? "bg-stamp-green-light border-stamp-green text-stamp-green"
                            : "bg-wash border-seal text-seal"
                          : "bg-paper border-hairline text-ink-light hover:border-ink-light"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-ink block mb-1">Justification note</label>
                <textarea
                  value={reviewerNote}
                  onChange={(e) => setReviewerNote(e.target.value)}
                  placeholder="State statutory reason for override or approval…"
                  rows={3}
                  className="w-full bg-paper border border-hairline rounded-md p-2 text-sm text-ink focus:outline-none focus:border-seal font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-hairline">
              <button onClick={() => setActiveItem(null)} className="px-4 py-2 text-xs text-ink-light hover:text-ink cursor-pointer">
                Close
              </button>
              <button
                onClick={handleDecisionSubmit}
                disabled={submitting}
                className="px-4 py-2 text-xs font-medium bg-seal text-white rounded-md transition-colors disabled:opacity-50 cursor-pointer"
              >
                {submitting ? "Saving…" : "Record decision"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
