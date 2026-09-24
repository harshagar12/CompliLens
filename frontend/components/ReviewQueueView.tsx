"use client";

import React, { useState, useEffect } from "react";
import { AlertTriangle, CheckCircle, XCircle, ShieldAlert, UserCheck, RefreshCw } from "lucide-react";
import { getReviewQueue, submitReviewDecision, API_BASE_URL } from "../lib/api";

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
      setQueue(items);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, []);

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
    } catch (e) {
      alert("Failed to submit decision");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            Human Review & Inspector Triage Queue
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Cases where statutory rule logic flagged ambiguous exception conditions or partial compliance.
          </p>
        </div>
        <button
          onClick={loadQueue}
          className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh Queue</span>
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">Loading review items...</div>
      ) : queue.length === 0 ? (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-12 text-center">
          <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-white">No Pending Cases</h3>
          <p className="text-xs text-slate-400 mt-1">All evaluations are deterministically resolved.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {queue.map((item) => (
            <div
              key={item.evaluation_id}
              className="bg-slate-900/60 border border-amber-500/30 rounded-xl p-5 hover:border-amber-500/50 transition-colors"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div className="flex items-center space-x-3">
                  <span className="font-mono text-sm font-bold text-amber-400">{item.rule_id}</span>
                  <span className="text-xs text-slate-400">Package: <span className="font-mono text-slate-200">{item.package_id}</span></span>
                  <span className="text-xs text-slate-500">• Field: <span className="text-slate-300 font-semibold">{item.field_name}</span></span>
                </div>
                <button
                  onClick={() => {
                    setActiveItem(item);
                    setDecision("APPROVE");
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors self-start sm:self-auto"
                >
                  Triage Decision
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-8 space-y-2">
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-xs font-mono text-slate-300">
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">Extracted Value</span>
                    {item.extracted_value || "(empty)"}
                  </div>
                  <div className="bg-amber-950/20 p-2.5 rounded-lg border border-amber-500/20 text-xs text-amber-200">
                    <span className="text-amber-400 font-semibold block text-[10px] uppercase">Review Reason</span>
                    {item.notes}
                  </div>
                </div>

                {item.evidence_crop_url && (
                  <div className="md:col-span-4 bg-slate-950 p-2 rounded-lg border border-slate-800 flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${API_BASE_URL}${item.evidence_crop_url}`}
                      alt="Evidence Crop"
                      className="max-h-20 w-auto object-contain rounded"
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Triage Decision Modal */}
      {activeItem && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-cyan-400" />
                Inspector Decision ({activeItem.rule_id})
              </h3>
              <button onClick={() => setActiveItem(null)} className="text-slate-400 hover:text-white text-xs">
                Cancel
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Inspector / Officer Name</label>
                <input
                  type="text"
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Triage Decision Action</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setDecision("APPROVE")}
                    className={`p-2.5 rounded-lg border text-xs font-semibold transition-all ${
                      decision === "APPROVE"
                        ? "bg-blue-600/30 border-blue-500 text-blue-300"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    Confirm Finding
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecision("OVERRIDE_PASS")}
                    className={`p-2.5 rounded-lg border text-xs font-semibold transition-all ${
                      decision === "OVERRIDE_PASS"
                        ? "bg-emerald-600/30 border-emerald-500 text-emerald-300"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    Override PASS
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecision("OVERRIDE_FAIL")}
                    className={`p-2.5 rounded-lg border text-xs font-semibold transition-all ${
                      decision === "OVERRIDE_FAIL"
                        ? "bg-rose-600/30 border-rose-500 text-rose-300"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    Override FAIL
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Audit Justification / Note</label>
                <textarea
                  value={reviewerNote}
                  onChange={(e) => setReviewerNote(e.target.value)}
                  placeholder="State statutory reason for override or approval..."
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setActiveItem(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
              >
                Close
              </button>
              <button
                onClick={handleDecisionSubmit}
                disabled={submitting}
                className="px-4 py-2 text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors"
              >
                {submitting ? "Saving..." : "Record & Persist Decision"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
