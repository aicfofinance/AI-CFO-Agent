/**
 * SeverityBadge — pill label for finding severity levels.
 *
 * Uses inline style for exact hex colors per the documented exception in
 * CLAUDE.md: "inside SEVERITY_STYLES constant objects where the color is
 * explicitly mapped to a severity level and documented as such."
 */

type SeverityBadgeProps = {
  severity: "critical" | "high" | "medium" | "low";
};

/**
 * SEVERITY_CONFIG — the canonical mapping from severity level to display
 * label and exact hex colors. These are the only hex values in this file
 * and they exist solely to document the severity ↔ color relationship.
 *
 * critical: loss-100 bg (#FFE4E4), loss-700 text (#A21520)
 * high:     warning-100 bg (#FEF3C7), warning-700 text (#92400E)
 * medium:   primary-100 bg (#D9E9FF), primary-700 text (#183979)
 * low:      gray-100 bg (#F1F5F9), gray-700 text (#334155)
 */
const SEVERITY_CONFIG = {
  critical: { label: "Critical", bg: "#FFE4E4", text: "#A21520" },
  high: { label: "High", bg: "#FEF3C7", text: "#92400E" },
  medium: { label: "Medium", bg: "#D9E9FF", text: "#183979" },
  low: { label: "Low", bg: "#F1F5F9", text: "#334155" },
} as const;

export function SeverityBadge({ severity }: SeverityBadgeProps): React.JSX.Element {
  const config = SEVERITY_CONFIG[severity];

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: config.bg, color: config.text }}
    >
      {config.label}
    </span>
  );
}
