import { useState } from "react";
import Popup, { type PopupStatus, type SummaryResult } from "./Popup";

const demoSummary: SummaryResult = {
  readingTimeMinutes: 4,
  bullets: [
    "The article explains why concise summaries help readers decide what deserves deeper attention.",
    "It separates factual recap from interpretation so the result is easier to scan.",
    "The page argues that useful summaries should preserve context without copying the original text."
  ],
  keyInsights: [
    "Readable extraction matters as much as the model prompt.",
    "A small, focused popup works better than a crowded dashboard."
  ]
};

export function PopupExample() {
  const [status, setStatus] = useState<PopupStatus>("idle");

  return (
    <Popup
      status={status}
      pageTitle="How AI Summaries Change the Way People Read Long Articles"
      summary={status === "result" ? demoSummary : undefined}
      errorMessage={status === "error" ? "The AI service timed out. Try again in a moment." : undefined}
      onSummarize={() => setStatus("loading")}
      onRetry={() => setStatus("loading")}
      onCopy={() => navigator.clipboard.writeText("Copied demo summary")}
      onClear={() => setStatus("idle")}
    />
  );
}
