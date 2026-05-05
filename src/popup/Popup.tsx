import "./popup-component.css";

export type PopupStatus = "idle" | "loading" | "result" | "error";

export type SummaryResult = {
  bullets: string[];
  keyInsights: string[];
  readingTimeMinutes: number;
};

export type PopupProps = {
  status: PopupStatus;
  pageTitle: string;
  summary?: SummaryResult;
  errorMessage?: string;
  onSummarize: () => void;
  onRetry?: () => void;
  onCopy?: () => void;
  onClear?: () => void;
};

export function Popup({
  status,
  pageTitle,
  summary,
  errorMessage,
  onSummarize,
  onRetry,
  onCopy,
  onClear
}: PopupProps) {
  const isLoading = status === "loading";
  const hasResult = status === "result" && summary;
  const safeTitle = pageTitle?.trim() || "Current page";

  return (
    <main className="ai-popup" aria-busy={isLoading}>
      <section className="ai-popup__header" aria-label="Page summary">
        <p className="ai-popup__label">AI Page Summary</p>
        <h1 className="ai-popup__title" title={safeTitle}>
          {safeTitle}
        </h1>
      </section>

      <div className="ai-popup__stage" data-state={status}>
        {status === "idle" && (
          <section className="ai-popup__state" aria-label="Ready">
            <button className="ai-popup__primary" type="button" onClick={onSummarize}>
              Summarize Page
            </button>
          </section>
        )}

        {isLoading && (
          <section className="ai-popup__state" aria-live="polite" aria-label="Loading">
            <button className="ai-popup__primary" type="button" disabled>
              Summarizing
              <span className="ai-popup__dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>

            <div className="ai-popup__loading-copy">Reading page...</div>
            <div className="ai-popup__skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </section>
        )}

        {hasResult && (
          <section className="ai-popup__result" aria-label="Summary result">
            <div className="ai-popup__meta">
              <span>{summary.readingTimeMinutes} min read</span>
            </div>

            <div className="ai-popup__scroll">
              <ul className="ai-popup__summary-list">
                {summary.bullets.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>

              <section className="ai-popup__insights" aria-labelledby="key-insights-title">
                <h2 id="key-insights-title">Key Insights</h2>
                <ul>
                  {summary.keyInsights.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              </section>
            </div>

            <div className="ai-popup__actions">
              <button className="ai-popup__secondary" type="button" onClick={onCopy}>
                Copy
              </button>
              <button className="ai-popup__ghost" type="button" onClick={onClear}>
                Clear
              </button>
            </div>
          </section>
        )}

        {status === "error" && (
          <section className="ai-popup__state" aria-label="Error">
            <div className="ai-popup__error" role="alert">
              <strong>Couldn&apos;t summarize this page.</strong>
              <p>{errorMessage || "Something went wrong. Please try again."}</p>
            </div>
            <button
              className="ai-popup__primary"
              type="button"
              onClick={onRetry || onSummarize}
            >
              Retry
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

export default Popup;
