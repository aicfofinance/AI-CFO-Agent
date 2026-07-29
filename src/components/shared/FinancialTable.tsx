/**
 * FinancialTable — the canonical table component for all financial data.
 *
 * Design rules enforced here:
 *   - Container is rounded-none (data tables must not have rounded corners)
 *   - Numeric columns are right-aligned with font-numeric (tabular figures)
 *   - Null / undefined cells render as "—" (em dash) in text-muted
 *   - Row height is 44px (h-11) per FRONTEND_GUIDELINES Section 7.5
 *   - No column striping — row hover uses gray-50 only
 *
 * Per CLAUDE.md: "Chart containers and data table wrappers use rounded-none —
 * rounded corners read as marketing, not financial data."
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ColumnDef<T> = {
  /** Maps to a key in the row data object. */
  key: keyof T;
  /** Column header label (rendered in uppercase via CSS). */
  header: string;
  /** When true: right-aligns the cell and applies font-numeric. */
  numeric?: boolean;
  /**
   * Custom render function. When provided, receives the cell value and full
   * row. When absent, the raw value is converted to a string for display.
   */
  render?: (value: T[keyof T], row: T) => ReactNode;
};

type FinancialTableProps<T> = {
  columns: ColumnDef<T>[];
  data: T[];
  className?: string;
};

export function FinancialTable<T extends Record<string, unknown>>({
  columns,
  data,
  className,
}: FinancialTableProps<T>): React.JSX.Element {
  return (
    <div className={cn("rounded-none overflow-hidden border border-gray-200", className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-100">
            {columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className={cn(
                  "px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500",
                  column.numeric === true ? "text-right" : "text-left",
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr key={rowIndex} className="h-11 border-b border-gray-100 hover:bg-gray-50">
              {columns.map((column, colIndex) => {
                const rawValue = row[column.key];

                let cellContent: ReactNode;

                if (rawValue === null || rawValue === undefined) {
                  // Em dash for empty/null cells — never leave a cell blank
                  cellContent = (
                    <span className="text-[#94A3B8]" aria-label="no value">
                      —
                    </span>
                  );
                } else if (column.render !== undefined) {
                  cellContent = column.render(rawValue, row);
                } else {
                  // Safe cast: financial table values are strings, numbers, or booleans
                  cellContent = String(rawValue as string | number | boolean);
                }

                return (
                  <td
                    key={colIndex}
                    className={cn(
                      "px-4 py-3",
                      column.numeric === true ? "text-right font-numeric" : "text-left",
                    )}
                  >
                    {cellContent}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
