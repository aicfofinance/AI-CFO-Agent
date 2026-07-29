/**
 * AIResponse — renders a single AI assistant message.
 *
 * Visual identity per FRONTEND_GUIDELINES:
 *   - Left border: primary-200 (#B3D3FF) — Section 8.3
 *   - When isStreaming: blinking cursor (▋) appended to content
 *   - Standard financial disclaimer always visible below content (required by CLAUDE.md)
 *
 * No "use client" directive — this is a pure rendering component with no hooks.
 */

const FINANCIAL_DISCLAIMER =
  "This is AI-generated analysis of your accounting data. It is not financial advice. " +
  "Consult a qualified financial professional for decisions requiring expert judgment.";

type AIResponseProps = {
  content: string;
  isStreaming?: boolean;
};

export function AIResponse({ content, isStreaming = false }: AIResponseProps): React.JSX.Element {
  return (
    <div className="border-l-4 border-l-[#B3D3FF] px-6 py-4">
      {/* Content area — whitespace-pre-wrap preserves paragraph breaks in AI output */}
      <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--text-primary)]">
        {content.length === 0 && isStreaming ? (
          // Initial streaming state before first chunk arrives
          <span className="italic text-[var(--text-muted)]">
            Analyzing your financial data&hellip;
          </span>
        ) : (
          content
        )}

        {isStreaming && (
          <>
            {/* Blinking cursor indicates active stream — animate-pulse gives a visible pulse effect */}
            <span className="animate-pulse" aria-hidden="true">
              ▋
            </span>
            {/* Screen-reader announcement for streaming state */}
            <span className="sr-only">Generating response</span>
          </>
        )}
      </div>

      {/*
       * Financial disclaimer — required per CLAUDE.md AI Integration Rules.
       * Always visible below the message; never hidden, never collapsed.
       */}
      <p className="mt-3 text-xs text-[var(--text-muted)]">{FINANCIAL_DISCLAIMER}</p>
    </div>
  );
}
