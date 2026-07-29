import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { alertConfigs } from "@/lib/platform/db/schema";
import type { AlertConfigItem } from "@/types/api";

/**
 * The four finding types surfaced on the notification-settings page, in the
 * fixed display order the frontend renders them. Declared `as const satisfies`
 * so the runtime array can never drift from the `AlertConfigItem` union.
 */
const ALERT_TYPES = [
  "cash_flow_risk",
  "anomaly",
  "collections_opportunity",
  "duplicate_subscription",
] as const satisfies readonly AlertConfigItem["alertType"][];

/**
 * GET /api/alert-configs — the caller's notification preferences.
 *
 * Requires session. Returns 401 if unauthenticated, 403 if the user has no org
 * membership, 500 on unexpected error.
 *
 * Always returns exactly four rows, one per finding type, in `ALERT_TYPES`
 * order. An org created before configs were seeded may have fewer than four
 * rows persisted; the missing types are backfilled with the enabled-by-default
 * shape `{ isEnabled: true, emailNotifications: true }` rather than omitted, so
 * the frontend can render all four toggles unconditionally.
 *
 * The org filter is always sourced from `getRequestContext()` — never from user
 * input (CLAUDE.md, Multi-tenancy Rules).
 *
 * Response 200: `{ data: AlertConfigItem[] }`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);

    const rows = await db
      .select({
        alertType: alertConfigs.alertType,
        isEnabled: alertConfigs.isEnabled,
        emailNotifications: alertConfigs.emailNotifications,
      })
      .from(alertConfigs)
      .where(eq(alertConfigs.orgId, orgId));

    const byType = new Map(rows.map((row) => [row.alertType, row]));

    const data: AlertConfigItem[] = ALERT_TYPES.map((alertType) => {
      const row = byType.get(alertType);
      return {
        alertType,
        isEnabled: row?.isEnabled ?? true,
        emailNotifications: row?.emailNotifications ?? true,
      };
    });

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "alert_configs_list_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "alert_configs_list_failed",
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
