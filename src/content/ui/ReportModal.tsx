import { useState } from "react";
import type { Platform, SubtitleCue } from "@/types/subtitle";
import { reportCue } from "@/shared/messaging";
import { pickText } from "./pickText";

const REASONS: { key: string; label: string }[] = [
  { key: "AWKWARD",  label: "Awkward word or phrase" },
  { key: "UNCLEAR",  label: "Sentence is unclear or confusing" },
  { key: "OTHER",    label: "Other" },
];

interface ReportModalProps {
  platform: Platform;
  videoId: string;
  cue: SubtitleCue;
  cueIndex: number;
  language: string;
  onClose: () => void;
}

export function ReportModal({ platform, videoId, cue, cueIndex, language, onClose }: ReportModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote]         = useState("");
  const [status, setStatus]     = useState<"idle" | "loading" | "done" | "error">("idle");

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0 || status === "loading") return;
    setStatus("loading");
    const translation = pickText(cue.text, language as any) ?? "";
    const ok = await reportCue({
      platform,
      videoId,
      cueIndex,
      cueStart: cue.start,
      cueEnd: cue.end,
      textKo: cue.text.ko,
      translation,
      language,
      reasonKeys: [...selected],
      note: note.trim(),
    });
    setStatus(ok ? "done" : "error");
    if (ok) {
      setTimeout(onClose, 2000);
    }
  };

  const stopEvent = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    (e.nativeEvent as Event).stopImmediatePropagation();
  };

  return (
    <div
      className="kaptik-report-backdrop"
      onClick={onClose}
      onKeyDown={stopEvent}
      onKeyUp={stopEvent}
      onScroll={stopEvent}
      role="dialog"
      aria-modal="true"
    >
      <div className="kaptik-report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kaptik-report-header">
          <span className="kaptik-report-title">Report subtitle</span>
          <button type="button" className="kaptik-report-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {status === "done" ? (
          <div className="kaptik-report-success">Report submitted. Thank you!</div>
        ) : (
          <>
            <div className="kaptik-report-reasons">
              {REASONS.map(({ key, label }) => (
                <label key={key} className={"kaptik-report-reason" + (selected.has(key) ? " is-selected" : "")}>
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    onChange={() => toggle(key)}
                  />
                  {label}
                </label>
              ))}
            </div>

            <textarea
              className="kaptik-report-note"
              placeholder="Additional details (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />

            {status === "error" && (
              <div className="kaptik-report-error">Failed to submit. Please try again.</div>
            )}

            <div className="kaptik-report-actions">
              <button type="button" className="kaptik-report-cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={"kaptik-report-submit" + (selected.size === 0 || status === "loading" ? " is-disabled" : "")}
                onClick={handleSubmit}
                disabled={selected.size === 0 || status === "loading"}
              >
                {status === "loading" ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
