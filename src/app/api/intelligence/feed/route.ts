import { NextResponse } from "next/server";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { findings } from "@/lib/platform/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";

/**
 * A single finding as returned in the Intelligence Feed. This is the shape
 * nested under each element of the `{ data: FindingFeedItem[] }` success
 * envelope. `hasActionableType` is derived (not a column): it tells the UI
 * whether the finding supports agentic draft generation.
 *
 * Monetary values live inside `relatedData` as DECIMAL strings exactly as they
 * left Postgres — they are never parsed to a JS `number` (CLAUDE.md, Financial
 * Data Rules).
 */
type FindingFeedItem = {
  id: string;
  findingType: string;
  severity: string;
  headline: string;
  detail: string;
  recommendedAction: string | null;
  relatedData: Record<string, unknown>;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  hasActionableType: boolean;
};

/**
 * Pagination + aggregate metadata returned under `meta`. `bySeverity` counts
 * ALL active, non-expired findings for the org (not just the current page) so
 * the UI can render severity badges without a second request. `total` is the
 * same population summed across tiers.
 */
type FindingFeedMeta = {
  bySeverity: { critical: number; high: number; medium: number; low: number };
  nextCursor: string | null;
  total: number;
  /**
   * True when at least one `medium` finding was suppressed from the feed for
   * being older than 14 days (Step 14.2). The UI uses this to show the one-time
   * "medium findings moved to Alerts archive" prompt. Critical/high findings are
   * never suppressed.
   */
  mediumFindingsSuppressed: boolean;
};

/**
 * Age past which `medium`-severity findings are suppressed from the live feed
 * (Step 14.2). After 14 days of inaction a medium finding drops out of the feed
 * (it remains in the Alerts archive) so the feed reflects still-relevant items.
 * Critical/high findings are never suppressed by age.
 */
const MEDIUM_SUPPRESSION_DAYS = 14;

/** Opaque cursor payload — the sort key of the last item on the previous page. */
type FeedCursor = {
  createdAt: string;
  id: string;
};

/** Findings per page (CLAUDE.md: cursor-based pagination for findings). */
const PAGE_SIZE = 20;

/**
 * Finding types that support agentic draft generation. `anomaly` is
 * informational only and has no draft action, so it is the sole `false` case
 * (see AGENTS.md, finding-type registration).
 */
const ACTIONABLE_FINDING_TYPES: ReadonlySet<string> = new Set([
  "cash_flow_risk",
  "collections_opportunity",
  "duplicate_subscription",
  "margin_alert",
]);

/** Severity → sort priority (critical first). Unknown values sort last. */
function severityCount(
  rows: Array<{ severity: string; count: number }>,
): FindingFeedMeta["bySeverity"] {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of rows) {
    if (row.severity === "critical") counts.critical = row.count;
    else if (row.severity === "high") counts.high = row.count;
    else if (row.severity === "medium") counts.medium = row.count;
    else if (row.severity === "low") counts.low = row.count;
  }
  return counts;
}

/** Decodes the Base64 cursor; returns null if malformed (treated as no cursor). */
function decodeCursor(raw: string | null): FeedCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "createdAt" in parsed &&
      "id" in parsed &&
      typeof (parsed as FeedCursor).createdAt === "string" &&
      typeof (parsed as FeedCursor).id === "string"
    ) {
      return { createdAt: (parsed as FeedCursor).createdAt, id: (parsed as FeedCursor).id };
    }
    return null;
  } catch {
    return null;
  }
}

/** Encodes the sort key of the last returned item as an opaque Base64 cursor. */
function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
}

/**
 * GET /api/intelligence/feed?cursor=...
 *
 * Requires session. Returns 401 if unauthenticated, 403 if the user has no org
 * membership, 500 on unexpected error.
 *
 * Returns the org's active Intelligence Feed under the standard `{ data, meta }`
 * envelope. Findings are filtered to `status = 'active'` AND (`expires_at IS
 * NULL` OR `expires_at > NOW()`) — both conditions are always applied
 * (CLAUDE.md, Intelligence Engine Rules). They are sorted critical → high →
 * medium → low, then `created_at DESC` within each tier.
 *
 * Pagination is cursor-based (20 per page). The cursor is a Base64-encoded
 * `{ createdAt, id }`; the WHERE predicate advances by `created_at`/`id` while
 * the ORDER BY keeps the severity-first presentation order. `meta.bySeverity`
 * and `meta.total` count the full active population, not just the page.
 *
 * The org filter is always sourced from `getRequestContext()` — never from user
 * input (CLAUDE.md, Multi-tenancy Rules).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);

    // TEMPORARY DIAGNOSTIC — remove after confirming feed works
    const [rawCount] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(findings)
      .where(eq(findings.orgId, orgId));
    console.error({
      event: "intelligence_feed_diagnostic",
      orgId,
      rawCountForOrg: rawCount?.count ?? 0,
      request_id,
    });

    const cursor = decodeCursor(new URL(request.url).searchParams.get("cursor"));

    // Medium findings older than this instant are suppressed from the feed (Step
    // 14.2). Computed once so the page/count filter and the suppression-detection
    // query use the same cutoff.
    const suppressionCutoff = new Date(
      Date.now() - MEDIUM_SUPPRESSION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Both conditions are ALWAYS applied together (CLAUDE.md): active status and
    // the non-expired window. A `cash_flow_risk` finding past its risk date is no
    // longer actionable and must not appear even though its status is 'active'.
    // The final predicate suppresses `medium` findings older than 14 days (Step
    // 14.2) — critical/high are never age-suppressed.
    const activeFilter = and(
      eq(findings.orgId, orgId),
      eq(findings.status, "active"),
      sql`(${findings.expiresAt} IS NULL OR ${findings.expiresAt} > now())`,
      // Exclude medium findings older than 14 days.
      sql`NOT (${findings.severity} = 'medium' AND ${findings.createdAt} <= ${suppressionCutoff})`,
    );

    // Feed-style cursor: advance strictly past the last item's (created_at, id).
    // ORDER BY is by severity first, so this is the documented simplification —
    // it keeps pages disjoint by the created_at/id tiebreak (Step 6.10 spec).
    const pageFilter = cursor
      ? and(
          activeFilter,
          sql`(${findings.createdAt} < ${cursor.createdAt} OR (${findings.createdAt} = ${cursor.createdAt} AND ${findings.id} < ${cursor.id}))`,
        )
      : activeFilter;

    const severityOrder = sql`CASE ${findings.severity} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`;

    // Fetch one extra row to detect whether a further page exists.
    const rows = await db
      .select({
        id: findings.id,
        findingType: findings.findingType,
        severity: findings.severity,
        headline: findings.headline,
        detail: findings.detail,
        recommendedAction: findings.recommendedAction,
        relatedData: findings.relatedData,
        status: findings.status,
        createdAt: findings.createdAt,
        expiresAt: findings.expiresAt,
      })
      .from(findings)
      .where(pageFilter)
      .orderBy(severityOrder, desc(findings.createdAt))
      .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    const data: FindingFeedItem[] = pageRows.map((row) => ({
      id: row.id,
      findingType: row.findingType,
      severity: row.severity,
      headline: row.headline,
      detail: row.detail,
      recommendedAction: row.recommendedAction,
      relatedData: row.relatedData,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      hasActionableType: ACTIONABLE_FINDING_TYPES.has(row.findingType),
    }));

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? encodeCursor({ createdAt: lastRow.createdAt.toISOString(), id: lastRow.id })
        : null;

    // Severity breakdown across the FULL active population (not just the page).
    const countRows = await db
      .select({
        severity: findings.severity,
        count: sql<number>`count(*)::int`,
      })
      .from(findings)
      .where(activeFilter)
      .groupBy(findings.severity);

    const bySeverity = severityCount(countRows);
    const total = bySeverity.critical + bySeverity.high + bySeverity.medium + bySeverity.low;

    // Detect whether any active, non-expired medium finding was suppressed by the
    // 14-day age cutoff (Step 14.2). This mirrors `activeFilter` but inverts the
    // medium/age predicate to count exactly the population excluded above, so the
    // UI can show the one-time "moved to Alerts archive" prompt.
    const [suppressedMediumRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(findings)
      .where(
        and(
          eq(findings.orgId, orgId),
          eq(findings.status, "active"),
          eq(findings.severity, "medium"),
          sql`(${findings.expiresAt} IS NULL OR ${findings.expiresAt} > now())`,
          sql`${findings.createdAt} <= ${suppressionCutoff}`,
        ),
      );
    const mediumFindingsSuppressed = (suppressedMediumRow?.count ?? 0) > 0;

    const meta: FindingFeedMeta = { bySeverity, nextCursor, total, mediumFindingsSuppressed };

    return NextResponse.json({ data, meta }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "intelligence_feed_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "intelligence_feed_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      request_id,
    });
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
          request_id,
        },
      },
      { status: 500 },
    );
  }
}
