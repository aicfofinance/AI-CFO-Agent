import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { findings } from "@/lib/platform/db/schema";
import type { FindingArchiveItem } from "@/types/api";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";

/** Findings per page (CLAUDE.md: cursor-based pagination for findings). */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Finding types that support agentic draft generation. `anomaly` is
 * informational only and has no draft action, so it is the sole `false` case
 * (matches `GET /api/intelligence/feed`; see AGENTS.md, finding-type registration).
 */
const ACTIONABLE_FINDING_TYPES: ReadonlySet<string> = new Set([
  "cash_flow_risk",
  "collections_opportunity",
  "duplicate_subscription",
  "margin_alert",
]);

/**
 * Query params for the archive endpoint. All optional; `status` defaults to
 * `all` (the archive shows every status) and `limit` defaults to 20, capped at
 * 100. `startDate` / `endDate` are ISO date strings compared against
 * `created_at`.
 */
const QuerySchema = z.object({
  status: z.enum(["active", "dismissed", "actioned", "all"]).default("all"),
  finding_type: z.string().optional(),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

/** Opaque cursor payload — the sort key of the last item on the previous page. */
type ArchiveCursor = {
  createdAt: string;
  id: string;
};

/** Decodes the Base64 cursor; returns null if malformed (treated as no cursor). */
function decodeCursor(raw: string | undefined): ArchiveCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "createdAt" in parsed &&
      "id" in parsed &&
      typeof (parsed as ArchiveCursor).createdAt === "string" &&
      typeof (parsed as ArchiveCursor).id === "string"
    ) {
      return { createdAt: (parsed as ArchiveCursor).createdAt, id: (parsed as ArchiveCursor).id };
    }
    return null;
  } catch {
    return null;
  }
}

/** Encodes the sort key of the last returned item as an opaque Base64 cursor. */
function encodeCursor(cursor: ArchiveCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
}

/**
 * GET /api/intelligence/findings
 *
 * Requires session. Returns 401 if unauthenticated, 403 if the user has no org
 * membership, 400 on invalid query params, 500 on unexpected error.
 *
 * The multi-status finding ARCHIVE that backs the `/alerts` page — distinct
 * from `GET /api/intelligence/feed`, which returns only the active,
 * non-expired feed. This endpoint returns findings across all statuses and,
 * critically, does NOT apply the expiry filter for `status=all|dismissed|
 * actioned` (the archive is historical). The one exception is `status=active`,
 * which reproduces the feed's filter exactly — `status='active'` AND
 * (`expires_at IS NULL` OR `expires_at > now()`) — so
 * `GET /api/intelligence/findings?status=active` returns the same population as
 * the feed.
 *
 * Query params (all optional): `status` (active|dismissed|actioned|all,
 * default all), `finding_type`, `severity`, `startDate`, `endDate`, `cursor`,
 * `limit` (default 20, max 100). Results sort `created_at DESC, id DESC` and
 * paginate cursor-first (CLAUDE.md: cursor pagination for findings).
 *
 * The org filter is always sourced from `getRequestContext()` — never from user
 * input (CLAUDE.md, Multi-tenancy Rules).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);

    const url = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      finding_type: url.searchParams.get("finding_type") ?? undefined,
      severity: url.searchParams.get("severity") ?? undefined,
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_QUERY",
            message: parsed.error.issues[0]?.message ?? "Invalid query parameters.",
            details: parsed.error.issues,
            request_id,
          },
        },
        { status: 400 },
      );
    }

    const { status, finding_type, severity, startDate, endDate, cursor, limit } = parsed.data;

    // Validate free-form date strings up front so a bad date is a 400, not a
    // silent no-op filter or a 500 downstream.
    let startBound: Date | null = null;
    let endBound: Date | null = null;
    if (startDate !== undefined) {
      const d = new Date(startDate);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          {
            error: {
              code: "INVALID_QUERY",
              message: "startDate is not a valid date.",
              request_id,
            },
          },
          { status: 400 },
        );
      }
      startBound = d;
    }
    if (endDate !== undefined) {
      const d = new Date(endDate);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          {
            error: {
              code: "INVALID_QUERY",
              message: "endDate is not a valid date.",
              request_id,
            },
          },
          { status: 400 },
        );
      }
      endBound = d;
    }

    // Base filter: always org-scoped (CLAUDE.md, Multi-tenancy Rules), plus the
    // optional status/type/severity/date filters. The cursor predicate is added
    // separately so the count query reflects the full filtered population.
    const conditions: SQL[] = [eq(findings.orgId, orgId)];

    if (status === "active") {
      // Reproduce the feed filter exactly: active AND non-expired. Both
      // conditions are always applied together (CLAUDE.md, Intelligence Rules).
      conditions.push(eq(findings.status, "active"));
      conditions.push(sql`(${findings.expiresAt} IS NULL OR ${findings.expiresAt} > now())`);
    } else if (status === "dismissed") {
      conditions.push(eq(findings.status, "dismissed"));
    } else if (status === "actioned") {
      conditions.push(eq(findings.status, "actioned"));
    }
    // status === 'all': no status filter and NO expiry filter — full archive.

    if (finding_type !== undefined) conditions.push(eq(findings.findingType, finding_type));
    if (severity !== undefined) conditions.push(eq(findings.severity, severity));
    if (startBound !== null) conditions.push(gte(findings.createdAt, startBound));
    if (endBound !== null) conditions.push(lte(findings.createdAt, endBound));

    const baseFilter = and(...conditions);

    const decodedCursor = decodeCursor(cursor);
    const pageFilter = decodedCursor
      ? and(
          baseFilter,
          sql`(${findings.createdAt} < ${decodedCursor.createdAt} OR (${findings.createdAt} = ${decodedCursor.createdAt} AND ${findings.id} < ${decodedCursor.id}))`,
        )
      : baseFilter;

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
        dismissedAt: findings.dismissedAt,
        dismissReason: findings.dismissReason,
      })
      .from(findings)
      .where(pageFilter)
      .orderBy(desc(findings.createdAt), desc(findings.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const data: FindingArchiveItem[] = pageRows.map((row) => ({
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
      dismissedAt: row.dismissedAt ? row.dismissedAt.toISOString() : null,
      dismissReason: row.dismissReason,
    }));

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? encodeCursor({ createdAt: lastRow.createdAt.toISOString(), id: lastRow.id })
        : null;

    // Total across the FULL filtered population (not just the page); the cursor
    // predicate is intentionally excluded here.
    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(findings)
      .where(baseFilter);

    const total = countRow?.total ?? 0;

    return NextResponse.json({ data, meta: { total, nextCursor } }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "intelligence_findings_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "intelligence_findings_failed",
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
