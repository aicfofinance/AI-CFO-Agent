import { asc, eq } from "drizzle-orm";
import JSZip from "jszip";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import {
  actionDrafts,
  conversations,
  findings,
  messages,
  organizations,
  reports,
} from "@/lib/platform/db/schema";
import type { MessageDetail } from "@/types/api";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * GET /api/data/export — download a zip of all AI-generated data for the org
 * (Step 10.5).
 *
 * Requires session. Returns 401 if unauthenticated, 403 if the user has no org
 * membership, 429 if the org exported within the last hour (Retry-After set),
 * 503 if zip generation fails.
 *
 * The org is always sourced from `getRequestContext()`, never from a query
 * param, and every org-scoped query is filtered by it (CLAUDE.md, Multi-tenancy
 * Rules). This endpoint reads only AI-generated outputs (conversations,
 * findings, drafts, reports) — raw transaction data is never re-exported; it
 * lives in the user's QuickBooks/Xero account.
 *
 * Zip layout:
 *   README.txt                       — describes the archive and where raw data lives
 *   conversations/conversations.json — full Q&A history with messages
 *   findings/findings.json           — every intelligence finding (all statuses)
 *   action_drafts/drafts.json        — every AI-generated email draft
 *   reports/index.json               — summary of all reports (guarantees the dir)
 *   reports/[id].json                — one file per report with its full content
 *
 * The response is served as `application/zip` with a `Content-Disposition:
 * attachment` header so the browser downloads it.
 */

/** One export per org per hour. */
const EXPORT_WINDOW_SECONDS = 3600;
const EXPORT_WINDOW_MS = EXPORT_WINDOW_SECONDS * 1000;

/**
 * Upstash fixed-window limiter, lazily built from the validated `env` (never
 * `process.env` — CLAUDE.md). When Upstash is not configured (e.g. local dev /
 * tests) this returns `null` and the in-process Map fallback below enforces the
 * window instead, so the "one export per hour" rule holds in every environment.
 */
let ratelimit: Ratelimit | null = null;
function getRatelimit(): Ratelimit | null {
  if (ratelimit) {
    return ratelimit;
  }
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  ratelimit = new Ratelimit({
    redis: new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.fixedWindow(1, `${EXPORT_WINDOW_SECONDS} s`),
    analytics: false,
    prefix: "export",
  });
  return ratelimit;
}

/**
 * Best-effort per-instance window used only when Upstash is unconfigured. A full
 * export is a heavy full-table read, so this throttles abusive repeat calls; it
 * is a courtesy limit, not a security control.
 */
const lastExportByOrg = new Map<string, number>();

/** 429 body + Retry-After header, shared by both rate-limit paths. */
function rateLimited(retryAfterSeconds: number, request_id: string): NextResponse {
  const seconds = Math.max(1, retryAfterSeconds);
  const availableAt = new Date(Date.now() + seconds * 1000).toISOString();
  return NextResponse.json(
    {
      error: {
        code: "EXPORT_RATE_LIMITED",
        message: `You can export again after ${availableAt}. Try again in about ${Math.ceil(
          seconds / 60,
        )} minute(s).`,
        request_id,
      },
    },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );
}

/** Narrows the DB `role` VARCHAR to the `MessageDetail` union. */
function narrowRole(role: string): MessageDetail["role"] {
  return role === "assistant" ? "assistant" : "user";
}

type ExportedConversation = {
  id: string;
  title: string;
  createdAt: string;
  messages: MessageDetail[];
};

const README = (exportedAt: string): string =>
  `AI CFO Agent — Data Export
Generated: ${exportedAt}

conversations/conversations.json — Your Q&A history with the AI CFO
findings/findings.json — All intelligence findings generated for your organization
action_drafts/drafts.json — All AI-generated email drafts
reports/ — Monthly financial reports

Note: Raw transaction data lives in your QuickBooks or Xero account.
This export contains only AI-generated outputs from the AI CFO Agent.
`;

export async function GET(request: Request): Promise<Response> {
  const request_id = crypto.randomUUID();

  try {
    // 1. Session → org context. Always the source of truth for the org.
    const { orgId } = await getRequestContext(request);

    // 2. Rate limit: one export per org per hour. Prefer Upstash; fall back to
    //    an in-process window when Upstash is unconfigured so the rule always
    //    holds. Both surface Retry-After (seconds) for the client.
    const limiter = getRatelimit();
    if (limiter) {
      const result = await limiter.limit(orgId);
      if (!result.success) {
        const retryAfter = Math.ceil((result.reset - Date.now()) / 1000);
        return rateLimited(retryAfter, request_id);
      }
    } else {
      const now = Date.now();
      const previous = lastExportByOrg.get(orgId);
      if (previous !== undefined && now - previous < EXPORT_WINDOW_MS) {
        const retryAfter = Math.ceil((previous + EXPORT_WINDOW_MS - now) / 1000);
        return rateLimited(retryAfter, request_id);
      }
    }

    // 3. Gather the org's data. Every query is filtered by the session org.
    const [org] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    // A missing org row for an authenticated, org-scoped request is a context
    // integrity failure, not an empty export — treat it as an internal error.
    if (!org) {
      console.error({ event: "data_export_org_missing", orgId, request_id });
      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ORG_CONTEXT_MISSING",
            message: "Organization context could not be resolved.",
            request_id,
          },
        },
        { status: 500 },
      );
    }

    const conversationRows = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .where(eq(conversations.orgId, orgId))
      .orderBy(asc(conversations.createdAt));

    const messageRows = await db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
        modelUsed: messages.modelUsed,
      })
      .from(messages)
      .where(eq(messages.orgId, orgId))
      .orderBy(asc(messages.conversationId), asc(messages.createdAt));

    const findingRows = await db
      .select({
        id: findings.id,
        findingType: findings.findingType,
        severity: findings.severity,
        headline: findings.headline,
        detail: findings.detail,
        recommendedAction: findings.recommendedAction,
        status: findings.status,
        relatedData: findings.relatedData,
        createdAt: findings.createdAt,
        expiresAt: findings.expiresAt,
      })
      .from(findings)
      .where(eq(findings.orgId, orgId))
      .orderBy(asc(findings.createdAt));

    const draftRows = await db
      .select({
        id: actionDrafts.id,
        findingId: actionDrafts.findingId,
        actionType: actionDrafts.actionType,
        subjectLine: actionDrafts.subjectLine,
        draftContent: actionDrafts.draftContent,
        status: actionDrafts.status,
        createdAt: actionDrafts.createdAt,
      })
      .from(actionDrafts)
      .where(eq(actionDrafts.orgId, orgId))
      .orderBy(asc(actionDrafts.createdAt));

    const reportRows = await db
      .select({
        id: reports.id,
        reportType: reports.reportType,
        periodStart: reports.periodStart,
        periodEnd: reports.periodEnd,
        status: reports.status,
        content: reports.content,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(eq(reports.orgId, orgId))
      .orderBy(asc(reports.periodStart));

    // 4. Assemble the archive. No monetary arithmetic happens here — JSON
    //    serialization preserves DECIMAL-as-string values verbatim (CLAUDE.md).
    const exportedAt = new Date().toISOString();

    const messagesByConversation = new Map<string, MessageDetail[]>();
    for (const row of messageRows) {
      const detail: MessageDetail = {
        id: row.id,
        role: narrowRole(row.role),
        content: row.content,
        createdAt: row.createdAt.toISOString(),
        modelUsed: row.modelUsed,
      };
      const existing = messagesByConversation.get(row.conversationId);
      if (existing) {
        existing.push(detail);
      } else {
        messagesByConversation.set(row.conversationId, [detail]);
      }
    }

    const exportedConversations: ExportedConversation[] = conversationRows.map((row) => ({
      id: row.id,
      title: row.title ?? "",
      createdAt: row.createdAt.toISOString(),
      messages: messagesByConversation.get(row.id) ?? [],
    }));

    const exportedFindings = findingRows.map((row) => ({
      id: row.id,
      findingType: row.findingType,
      severity: row.severity,
      headline: row.headline,
      detail: row.detail,
      recommendedAction: row.recommendedAction,
      status: row.status,
      relatedData: row.relatedData,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    }));

    const exportedDrafts = draftRows.map((row) => ({
      id: row.id,
      findingId: row.findingId,
      actionType: row.actionType,
      subjectLine: row.subjectLine,
      draftContent: row.draftContent,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }));

    const exportedReports = reportRows.map((row) => ({
      id: row.id,
      reportType: row.reportType,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      status: row.status,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    }));

    const zip = new JSZip();
    zip.file("README.txt", README(exportedAt));
    zip.file(
      "conversations/conversations.json",
      JSON.stringify({ exportedAt, conversations: exportedConversations }, null, 2),
    );
    zip.file(
      "findings/findings.json",
      JSON.stringify({ exportedAt, findings: exportedFindings }, null, 2),
    );
    zip.file(
      "action_drafts/drafts.json",
      JSON.stringify({ exportedAt, actionDrafts: exportedDrafts }, null, 2),
    );
    // index.json always exists, so the reports/ directory is present even when
    // the org has generated no reports yet (DoD: the zip contains reports/).
    zip.file(
      "reports/index.json",
      JSON.stringify(
        {
          exportedAt,
          reports: exportedReports.map((r) => ({
            id: r.id,
            reportType: r.reportType,
            periodStart: r.periodStart,
            periodEnd: r.periodEnd,
            status: r.status,
            createdAt: r.createdAt,
          })),
        },
        null,
        2,
      ),
    );
    for (const report of exportedReports) {
      zip.file(`reports/${report.id}.json`, JSON.stringify(report, null, 2));
    }

    const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });

    // Record the export only after it assembled successfully, so a mid-query
    // failure does not consume the org's hourly window (fallback path only).
    if (!limiter) {
      lastExportByOrg.set(orgId, Date.now());
    }

    const filenameDate = exportedAt.slice(0, 10);
    const filename = `${org.slug}_data-export_${filenameDate}.zip`;
    return new Response(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "data_export_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    // Zip generation / DB read failure — the archive could not be produced.
    console.error({
      event: "data_export_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      request_id,
    });
    return NextResponse.json(
      {
        error: {
          code: "EXPORT_GENERATION_FAILED",
          message: "The data export could not be generated. Please try again.",
          request_id,
        },
      },
      { status: 503 },
    );
  }
}
