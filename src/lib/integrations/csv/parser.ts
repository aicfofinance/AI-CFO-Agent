/**
 * QuickBooks Transaction Detail Report CSV parser.
 *
 * Wraps papaparse to handle QB's multi-row header format, where the first
 * several rows may be report metadata (title, date range) rather than the
 * column header row. The real header row is detected by looking for "Date" in
 * the first column position.
 */

import Papa from "papaparse";

/**
 * A single parsed row from a QuickBooks Transaction Detail Report CSV.
 * All monetary amounts are positive decimal strings; direction is encoded by
 * `transactionType` and resolved during normalization.
 */
export type ParsedCSVRow = {
  /** YYYY-MM-DD — converted from QB's MM/DD/YYYY format. */
  transactionDate: string;
  /** Raw QB type string, e.g. 'Invoice', 'Check', 'Bill Payment (Check)'. */
  transactionType: string;
  referenceNumber: string | null;
  vendorName: string | null;
  description: string | null;
  /** Always a positive decimal string, e.g. '125.00'. */
  amount: string;
  /** Raw value from the Account column; fed to `mapToInternalCategory()`. */
  categorySource: string | null;
};

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Converts a QB CSV date string to ISO 8601 YYYY-MM-DD.
 *
 * QB Transaction Detail Report exports dates as MM/DD/YYYY (or M/D/YYYY with
 * single-digit month/day). Also accepts dates already in YYYY-MM-DD format so
 * the parser handles both export variants without special-casing.
 *
 * Returns null when the string cannot be parsed into a valid date.
 */
function parseDateToISO(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Already YYYY-MM-DD — pass through.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // MM/DD/YYYY or M/D/YYYY (the standard QB export format).
  const parts = trimmed.split("/");
  if (parts.length === 3) {
    const [monthStr, dayStr, yearStr] = parts;
    if (!monthStr || !dayStr || !yearStr || yearStr.length !== 4) return null;
    const month = monthStr.padStart(2, "0");
    const day = dayStr.padStart(2, "0");
    return `${yearStr}-${month}-${day}`;
  }

  return null;
}

/**
 * Strips currency symbols (`$`), commas, and surrounding whitespace from a
 * raw amount string, converts parenthetical negatives `(1234.56)` to signed
 * form `-1234.56`, then returns `Math.abs(parsed).toFixed(2)` as a string.
 *
 * Returns null when the cleaned string is empty or does not parse as a finite
 * number (e.g. `'—'`, `'N/A'`).
 *
 * Note: we use `parseFloat` → `Math.abs` → `.toFixed(2)` here because the
 * amount is being converted from a display string to a canonical decimal string
 * before being stored. All subsequent arithmetic happens in SQL on DECIMAL
 * columns (CLAUDE.md — never in JS on parsed floats).
 */
function parseAmount(raw: string): string | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return null;

  // Convert parenthetical negatives: (1250.00) → -1250.00
  const parenMatch = /^\((.+)\)$/.exec(cleaned);
  const normalised = parenMatch?.[1] !== undefined ? `-${parenMatch[1]}` : cleaned;

  const num = parseFloat(normalised);
  if (!isFinite(num)) return null;

  return Math.abs(num).toFixed(2);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parses a QuickBooks Transaction Detail Report CSV export into structured rows.
 *
 * QB Transaction Detail Report CSVs typically prepend 3–5 metadata rows (report
 * title, company name, date range) before the real header row. This function
 * detects the header row by scanning for the first row whose first cell is
 * exactly `"Date"` — preceding rows are silently skipped.
 *
 * Rows are skipped (and logged with `console.error`) when:
 *   - The `Date` column is empty or cannot be parsed as a date.
 *   - The `Transaction Type` column is empty.
 *   - The `Amount` column is empty or cannot be parsed as a finite number.
 *
 * @param csvText - Raw UTF-8 text content of the QB CSV file.
 * @returns Array of validated, structured rows. Empty array when no valid rows
 *   are found or the header cannot be located.
 */
export function parseQBCSV(csvText: string): ParsedCSVRow[] {
  // Parse all rows as raw arrays (no header inference at this stage).
  const parseResult = Papa.parse<string[]>(csvText, {
    header: false,
    skipEmptyLines: true,
  });

  const allRows = parseResult.data;

  // ── Locate the real header row ─────────────────────────────────────────────
  // The first row whose first cell (trimmed) equals "Date" is the header.
  let headerIndex = -1;
  let headerRow: string[] = [];

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    if (!row || row.length === 0) continue;
    if ((row[0] ?? "").trim() === "Date") {
      headerIndex = i;
      headerRow = row.map((cell) => cell.trim());
      break;
    }
  }

  if (headerIndex === -1) {
    console.error({
      event: "csv_parse_no_header",
      reason: 'No header row found: expected a row with "Date" in the first column',
    });
    return [];
  }

  // ── Resolve column indices by name ─────────────────────────────────────────
  // QB column names are matched case-sensitively; the helper tries a list of
  // known aliases to handle minor format variations across QB versions.
  const findCol = (...names: string[]): number => {
    for (const name of names) {
      const idx = headerRow.indexOf(name);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const colDate = findCol("Date");
  const colType = findCol("Transaction Type");
  const colNum = findCol("Num");
  const colName = findCol("Name");
  const colMemo = findCol("Memo/Description", "Memo", "Description");
  const colAccount = findCol("Account");
  const colAmount = findCol("Amount");

  // Date, Transaction Type, and Amount are required. Without them we cannot
  // build a valid ParsedCSVRow.
  if (colDate === -1 || colType === -1 || colAmount === -1) {
    console.error({
      event: "csv_parse_missing_required_columns",
      reason:
        "CSV header row is missing one or more required columns: Date, Transaction Type, Amount",
      detectedHeader: headerRow,
    });
    return [];
  }

  // ── Process data rows ───────────────────────────────────────────────────────
  const rows: ParsedCSVRow[] = [];

  for (let i = headerIndex + 1; i < allRows.length; i++) {
    const row = allRows[i];
    if (!row) continue;

    // Helper: get a cell value at a given column index, trimmed.
    // Returns '' if the index is -1 (column not present in this file variant).
    const getCell = (idx: number): string => (idx >= 0 ? (row[idx] ?? "").trim() : "");

    const rawDate = getCell(colDate);
    const rawType = getCell(colType);
    const rawAmount = getCell(colAmount);

    // Skip rows with missing required fields.
    if (!rawDate) {
      console.error({ event: "csv_parse_skip", row: i, reason: "empty Date" });
      continue;
    }
    if (!rawType) {
      console.error({ event: "csv_parse_skip", row: i, reason: "empty Transaction Type" });
      continue;
    }
    if (!rawAmount) {
      console.error({ event: "csv_parse_skip", row: i, reason: "empty Amount" });
      continue;
    }

    const transactionDate = parseDateToISO(rawDate);
    if (!transactionDate) {
      console.error({
        event: "csv_parse_skip",
        row: i,
        reason: `unparseable date: "${rawDate}"`,
      });
      continue;
    }

    const amount = parseAmount(rawAmount);
    if (!amount) {
      console.error({
        event: "csv_parse_skip",
        row: i,
        reason: `unparseable amount: "${rawAmount}"`,
      });
      continue;
    }

    rows.push({
      transactionDate,
      transactionType: rawType,
      referenceNumber: getCell(colNum) || null,
      vendorName: getCell(colName) || null,
      description: getCell(colMemo) || null,
      amount,
      categorySource: getCell(colAccount) || null,
    });
  }

  return rows;
}
