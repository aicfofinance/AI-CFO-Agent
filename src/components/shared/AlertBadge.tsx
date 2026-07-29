/**
 * AlertBadge — small notification count pill.
 *
 * count === 0  → renders nothing
 * count 1–9   → shows the count
 * count ≥ 10  → shows "9+"
 *
 * Positioned absolutely so the parent element must have `position: relative`.
 */

type AlertBadgeProps = {
  count: number;
};

export function AlertBadge({ count }: AlertBadgeProps): React.JSX.Element | null {
  if (count === 0) return null;

  const display = count >= 10 ? "9+" : String(count);

  return (
    <span
      className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#E63946] px-1 text-[10px] font-medium leading-none text-white"
      aria-label={`${count} alert${count === 1 ? "" : "s"}`}
      role="status"
    >
      {display}
    </span>
  );
}
