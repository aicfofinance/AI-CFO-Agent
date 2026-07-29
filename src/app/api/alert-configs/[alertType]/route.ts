import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { alertConfigs } from "@/lib/platform/db/schema";
import type { AlertConfigItem } from "@/types/api";

/**
 * The four finding types a notification preference may target. The `:alertType`
 * path segment must match one of these exactly; anything else is a 400. Declared
 * `as const satisfies` so the runtime guard can never drift from the union.
 */
const ALERT_TYPES = [
  "cash_flow_risk",
  "anomaly",
  "collections_opportunity",
  "duplicate_subscription",
] as const satisfies readonly AlertConfigItem["alertType"][];

type AlertType = (typeof ALERT_TYPES)[number];

function isAlertType(value: string): value is AlertType {
  return (ALERT_TYPES as readonly string[]).includes(value);
}

/**
 * `thresholdValue` is `NOT NULL` with no DB default but is not user-configurable
 * in V1 (Step 14.1). When a config row is created via this PATCH's upsert, we
 * satisfy the column with a neutral placeholder; it is never surfaced or edited
 * through this endpoint.
 */
const DEFAULT_THRESHOLD = "0.0000";

/**
 * Request body for `PATCH /api/alert-configs/:alertType`. Both fields are
 * optional individually, but the `.refine()` requires at least one — a PATCH
 * that changes nothing is a 400. `orgId` is never accepted from the body; it is
 * always derived from the session (CLAUDE.md, Multi-tenancy Rules).
 */
const PatchAlertConfigSchema = z
  .object({
    isEnabled: z.boolean().optional(),
    emailNotifications: z.boolean().optional(),
  })
  .refine((body) => body.isEnabled !== undefined || body.emailNotifications !== undefined, {
    message: "At least one of `isEnabled` or `emailNotifications` must be provided.",
  });

/**
 * PATCH /api/alert-configs/:alertType — update one notification preference.
 *
 * Requires session. Returns 200 on success, 401 if unauthenticated, 403 if the
 * user has no org membership, 400 if `:alertType` is unknown or the body is
 * invalid (including an empty patch), 500 on unexpected error.
 *
 * Upserts on the `(org_id, alert_type)` unique index: a row is created for an
 * org that never had one seeded, otherwise the existing row is updated. Only the
 * fields present in the request body are written to the conflict `set` — an
 * omitted field retains its stored value. The org is always sourced from
 * `getRequestContext()`, never the URL or body.
 *
 * Response 200: `{ data: AlertConfigItem }`.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ alertType: string }> },
): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId, userId } = await getRequestContext(request);
    const { alertType } = await params;

    if (!isAlertType(alertType)) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Unknown alert type.",
            request_id,
          },
        },
        { status: 400 },
      );
    }

    const body: unknown = await request.json().catch(() => ({}));
    const parsed = PatchAlertConfigSchema.parse(body);

    // Only the provided fields are written. `exactOptionalPropertyTypes` forbids
    // assigning `undefined` to an optional key, so each is set conditionally.
    const changes: { isEnabled?: boolean; emailNotifications?: boolean } = {};
    if (parsed.isEnabled !== undefined) {
      changes.isEnabled = parsed.isEnabled;
    }
    if (parsed.emailNotifications !== undefined) {
      changes.emailNotifications = parsed.emailNotifications;
    }

    const [updated] = await db
      .insert(alertConfigs)
      .values({
        orgId,
        alertType,
        thresholdValue: DEFAULT_THRESHOLD,
        updatedBy: userId,
        ...changes,
      })
      .onConflictDoUpdate({
        target: [alertConfigs.orgId, alertConfigs.alertType],
        set: { ...changes, updatedBy: userId, updatedAt: new Date() },
      })
      .returning({
        isEnabled: alertConfigs.isEnabled,
        emailNotifications: alertConfigs.emailNotifications,
      });

    if (!updated) {
      throw new Error("Alert config upsert returned no row.");
    }

    const data: AlertConfigItem = {
      alertType,
      isEnabled: updated.isEnabled,
      emailNotifications: updated.emailNotifications,
    };

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "alert_config_update_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request body is invalid.",
            details: error.issues,
            request_id,
          },
        },
        { status: 400 },
      );
    }

    console.error({
      event: "alert_config_update_failed",
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
