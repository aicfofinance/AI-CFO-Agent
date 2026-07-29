import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { connections } from "@/lib/platform/db/schema";
import type { ConnectionSummary } from "@/types/api";

/**
 * GET /api/connections — list the org's connections.
 *
 * Requires session. Returns 401 if unauthenticated, 403 if the user has no org
 * membership, 500 on unexpected error.
 *
 * Sensitive columns (`access_token_encrypted`, `refresh_token_encrypted`,
 * `token_expiry`) are never selected — they are excluded from the query
 * projection itself, not merely dropped from the response object, so an
 * encrypted token value never leaves the database layer (CLAUDE.md, Security
 * Rules). The org filter is always sourced from `getRequestContext()`.
 *
 * Response 200: `{ data: ConnectionSummary[] }`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);

    const rows = await db
      .select({
        id: connections.id,
        provider: connections.provider,
        isActive: connections.isActive,
        lastSyncedAt: connections.lastSyncedAt,
        lastIntelligenceRunAt: connections.lastIntelligenceRunAt,
        syncStatus: connections.syncStatus,
        providerCompanyName: connections.providerCompanyName,
        realmId: connections.realmId,
      })
      .from(connections)
      .where(eq(connections.orgId, orgId))
      .orderBy(desc(connections.createdAt));

    const data: ConnectionSummary[] = rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      isActive: row.isActive,
      lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
      lastIntelligenceRunAt: row.lastIntelligenceRunAt
        ? row.lastIntelligenceRunAt.toISOString()
        : null,
      syncStatus: row.syncStatus,
      providerCompanyName: row.providerCompanyName,
      realmId: row.realmId,
    }));

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "connection_list_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "connection_list_failed",
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
