"use client";

/**
 * CashFlowChart — recharts ComposedChart rendering the cash-flow projection.
 *
 * Displays:
 *   - Green inflow bars
 *   - Red outflow bars (negated so they render below the zero line)
 *   - Net balance line (primary-500 blue)
 *   - ReferenceLine at y=0 (zero baseline)
 *   - Red ReferenceDot at the first risk date (if any)
 *
 * Container uses `rounded-none` per CLAUDE.md (chart containers must never
 * have rounded corners — they read as marketing, not financial data).
 *
 * `parseFloat` calls below are ONLY for converting DB decimal strings to chart
 * pixel positions (display-only). No monetary arithmetic is performed here.
 */

import React from "react";
import {
  ComposedChart,
  Bar,
  Line,
  ReferenceLine,
  ReferenceDot,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { formatCurrency } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types — match the actual API response shape from GET /api/cashflow/projection
// ---------------------------------------------------------------------------

type DailyBalance = {
  date: string; // ISO date string 'YYYY-MM-DD'
  projectedBalance: string; // DECIMAL string — running balance at end of day
  inflows: string; // DECIMAL string — expected to arrive this day
  outflows: string; // DECIMAL string — expected outgoing this day
};

type CashFlowChartProps = {
  projectedData: DailyBalance[];
  minimumProjectedBalance: string;
  riskDate: string | null;
  confidenceLevel: "low" | "medium" | "high";
};

// ---------------------------------------------------------------------------
// Confidence level color mapping
// Inline style exception per CLAUDE.md — analogous to SEVERITY_STYLES: the
// mapping table itself IS the documentation of valid values.
// ---------------------------------------------------------------------------

const CONFIDENCE_COLORS = {
  low: { bg: "#FEF3C7", text: "#92400E", label: "Low confidence" },
  medium: { bg: "#D9E9FF", text: "#183979", label: "Medium confidence" },
  high: { bg: "#D1FAE5", text: "#065F46", label: "High confidence" },
} as const;

// ---------------------------------------------------------------------------
// Chart component
// ---------------------------------------------------------------------------

export function CashFlowChart({
  projectedData,
  minimumProjectedBalance,
  riskDate,
  confidenceLevel,
}: CashFlowChartProps): React.JSX.Element {
  // Guard: empty projection (defensive — API always returns N days of data)
  if (projectedData.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-[var(--text-muted)]">
        No projection data available.
      </div>
    );
  }

  // Convert to recharts chart data.
  // parseFloat is ONLY for chart pixel positions — never for financial arithmetic.
  const chartData = projectedData.map((d) => ({
    date: d.date.slice(5), // "MM-DD" format for axis labels
    inflows: parseFloat(d.inflows),
    outflows: -parseFloat(d.outflows), // negative so bars render below zero
    balance: parseFloat(d.projectedBalance),
  }));

  // End-of-period balance is the last projected day's running balance.
  const lastEntry = projectedData.at(-1);
  const endOfPeriodBalance = lastEntry?.projectedBalance ?? "0.00";

  // Risk date formatted as "MM-DD" to match XAxis data keys.
  const riskDateFormatted = riskDate !== null ? riskDate.slice(5) : null;

  // XAxis tick interval: show ~6 evenly spaced ticks regardless of period length.
  const tickInterval = Math.max(4, Math.floor(projectedData.length / 6));

  const confidenceStyle = CONFIDENCE_COLORS[confidenceLevel];

  return (
    <div>
      {/* Summary metrics row */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">
            Projected End Balance
          </p>
          <CurrencyAmount value={endOfPeriodBalance} className="text-xl font-semibold" />
        </div>
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">
            Minimum Projected
          </p>
          <CurrencyAmount value={minimumProjectedBalance} className="text-xl font-semibold" />
        </div>
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">
            Confidence
          </p>
          <span
            style={{ backgroundColor: confidenceStyle.bg, color: confidenceStyle.text }}
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
          >
            {confidenceStyle.label}
          </span>
        </div>
      </div>

      {/* Chart header row */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-[var(--text-primary)]">Daily Cash Flow Projection</p>
        {riskDate !== null && (
          <span className="text-xs font-medium text-[#C42030]">
            {/* sr-only pairs the color with a text label per CLAUDE.md accessibility rules */}
            <span aria-hidden="true">⚠ </span>
            Risk projected <time dateTime={riskDate}>{riskDate}</time>
          </span>
        )}
      </div>

      {/* Chart container — rounded-none per CLAUDE.md */}
      <div className="overflow-hidden rounded-none">
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#64748B" }}
              tickLine={false}
              axisLine={{ stroke: "#E2E8F0" }}
              interval={tickInterval}
            />
            <YAxis
              tickFormatter={(value: number): string =>
                formatCurrency(value, { compact: true, showCents: false })
              }
              tick={{ fontSize: 11, fill: "#64748B" }}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <Tooltip
              formatter={(value) => {
                // value is recharts ValueType: number | string | Array<number | string>
                if (Array.isArray(value)) return "";
                const num = typeof value === "number" ? value : parseFloat(String(value));
                return formatCurrency(Math.abs(Number.isFinite(num) ? num : 0));
              }}
              contentStyle={{
                border: "1px solid #E2E8F0",
                borderRadius: "4px",
                fontSize: "12px",
                padding: "8px 12px",
              }}
              labelStyle={{ color: "#64748B", fontSize: "11px", marginBottom: "4px" }}
            />
            <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />

            {/* Inflows — gain-600 green */}
            <Bar dataKey="inflows" fill="#15803D" name="Inflows" maxBarSize={20} />

            {/* Outflows — loss-600 red (negated values render below zero) */}
            <Bar dataKey="outflows" fill="#C42030" name="Outflows" maxBarSize={20} />

            {/* Net balance line — primary-500 blue */}
            <Line
              type="monotone"
              dataKey="balance"
              stroke="#2557A7"
              strokeWidth={2}
              dot={false}
              name="Net Balance"
            />

            {/* Zero baseline */}
            <ReferenceLine y={0} stroke="#94A3B8" strokeDasharray="4 4" />

            {/* Risk date marker — only rendered when a risk date exists */}
            {riskDateFormatted !== null && (
              <ReferenceDot x={riskDateFormatted} y={0} r={6} fill="#C42030" stroke="none" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
