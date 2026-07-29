"use client";

/**
 * ChatInput — controlled textarea with a Send button for the /ask interface.
 *
 * Accessibility:
 *   - Send button is disabled when the textarea is empty or when `disabled` is true.
 *   - Enter (without Shift) submits the question; Shift+Enter inserts a newline.
 *   - Focus ring provided by the wrapping container's focus-within styles and
 *     the button's focus-visible:outline-* class.
 *
 * Usage:
 *   <ChatInput onSubmit={(q) => console.log(q)} />
 *   <ChatInput onSubmit={handleSubmit} initialValue="Tell me more about: X" />
 */

import { useState } from "react";
import { Send } from "lucide-react";

interface ChatInputProps {
  /** Called with the trimmed question text when the user submits. */
  onSubmit: (question: string) => void;
  /** Disables both the textarea and the send button when true. */
  disabled?: boolean;
  /**
   * Optional initial text to pre-fill the textarea with.
   * When provided, the textarea renders with this value already populated.
   * Use a `key` prop on ChatInput to reset when this value changes.
   */
  initialValue?: string;
}

export function ChatInput({
  onSubmit,
  disabled = false,
  initialValue = "",
}: ChatInputProps): React.JSX.Element {
  const [value, setValue] = useState(initialValue);

  const isEmpty = value.trim().length === 0;

  function handleSubmit(): void {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex items-end gap-2 rounded-lg border border-[var(--border-default)] bg-white px-4 py-3 shadow-sm focus-within:border-[var(--primary-500)] focus-within:ring-1 focus-within:ring-[var(--primary-200)]">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask a financial question..."
        disabled={disabled}
        rows={2}
        className="flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none disabled:opacity-50"
        aria-label="Financial question input"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isEmpty || disabled}
        aria-label="Send question"
        className="shrink-0 rounded p-1.5 text-[var(--primary-500)] transition-colors duration-100 hover:bg-[var(--primary-50)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary-500)] disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Send size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
