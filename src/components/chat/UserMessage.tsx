/**
 * UserMessage — renders a single user question in the chat thread.
 *
 * Right-aligned bubble with primary-50 background, matching the
 * institutional blue palette from FRONTEND_GUIDELINES Section 2.1.
 *
 * No "use client" directive — pure rendering component with no hooks.
 */

type UserMessageProps = {
  content: string;
};

export function UserMessage({ content }: UserMessageProps): React.JSX.Element {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-lg bg-[var(--primary-50)] px-4 py-3 text-[15px] leading-relaxed text-[var(--text-primary)]">
        {content}
      </div>
    </div>
  );
}
