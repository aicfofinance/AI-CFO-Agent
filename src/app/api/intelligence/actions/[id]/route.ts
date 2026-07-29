import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z, ZodError } from "zod";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { actionDrafts, findings } from "@/lib/platform/db/schema";

/**
 * Target statuses a client may request for an action draft. The terminal
 * lifecycle also includes the initial `draft` state, but a client can never
 * transition *into* `draft` — it is the creation default — so it is excluded
 * from the request enum. `.parse()` throws a `ZodError` on any other value,
 * which the handler translates into a 400.
 */
const TargetStatusSchema = z.object({
  status: z.enum(["approved", "copied", "rejected"]),
});

/**
 * Legal draft state transitions. The agentic review flow is strictly forward:
 *
 *   draft    → approved | rejected
 *   approved → copied   | rejected
 *
 * `copied` and `rejected` are terminal — no key exists for them, so any attempt
 * to transition out of a terminal state is illegal. There is deliberately no
 * `sent` state: the product never sends on the user's behalf, so `copied` is the
 * terminal success state (CLAUDE.md). Any (from → to) pair not represented here
 * yields a 400 `ILLEGAL_TRANSITION`.
 */
const LEGAL_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["approved", "rejected"],
  approved: ["copied", "rejected"],
};

/**
 * The columns updated on an action draft as it advances through review. The
 * `action_drafts` table has no `updated_at` column (see schema.ts) — the
 * lifecycle `*_at` timestamps are the record of when each transition occurred,
 * so only the one matching the target status is set.
 */
type DraftUpdate = {
  status: "approved" | "copied" | "rejected";
  approvedAt?: Date;
  copiedAt?: Date;
  rejectedAt?: Date;
};

/**
 * PATCH /api/intelligence/actions/:id
 *
 * Advances an AI-generated action draft through its review lifecycle. Requires
 * session. Returns 401 if unauthenticated, 403 if the user has no org
 * membership, 400 if the body fails validation or the transition is illegal,
 * 404 if the draft does not exist in the caller's org, 500 on unexpected error.
 *
 * Accepts `{ status: 'approved' | 'copied' | 'rejected' }` and validates the
 * transition against `LEGAL_TRANSITIONS`. On success sets the matching lifecycle
 * timestamp (`approved_at` / `copied_at` / `rejected_at`) and returns
 * `{ data: { id, status } }`.
 *
 * When a draft reaches `copied`, the parent finding is also marked
 * `status = 'actioned'` (with `actioned_at = NOW()`) in the same transaction so
 * both writes commit or roll back together — a copied draft whose finding still
 * shows `active` would be an inconsistent state.
 *
 * The draft is looked up with `WHERE id = :id AND org_id = :orgId` — a draft
 * that belongs to another org simply does not match, yielding a 404 that never
 * reveals its existence (CLAUDE.md, Multi-tenancy Rules). The org is always
 * sourced from `getRequestContext()`, never from user input.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);
    const { id } = await params;

    const body: unknown = await request.json();
    const { status: targetStatus } = TargetStatusSchema.parse(body);

    // Scope the lookup to the caller's org. A cross-org id yields no row → 404,
    // which does not leak whether the draft exists elsewhere.
    const [draft] = await db
      .select({
        id: actionDrafts.id,
        status: actionDrafts.status,
        findingId: actionDrafts.findingId,
      })
      .from(actionDrafts)
      .where(and(eq(actionDrafts.id, id), eq(actionDrafts.orgId, orgId)))
      .limit(1);

    if (!draft) {
      return NextResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Action draft not found.",
            request_id,
          },
        },
        { status: 404 },
      );
    }

    const allowed = LEGAL_TRANSITIONS[draft.status];
    if (!allowed?.includes(targetStatus)) {
      return NextResponse.json(
        {
          error: {
            code: "ILLEGAL_TRANSITION",
            message: `Cannot transition from ${draft.status} to ${targetStatus}.`,
            request_id,
          },
        },
        { status: 400 },
      );
    }

    const now = new Date();
    const updatePayload: DraftUpdate = { status: targetStatus };
    if (targetStatus === "approved") {
      updatePayload.approvedAt = now;
    } else if (targetStatus === "copied") {
      updatePayload.copiedAt = now;
    } else {
      updatePayload.rejectedAt = now;
    }

    if (targetStatus === "copied") {
      // Dual write: mark the draft copied and its parent finding actioned. Both
      // updates are org-scoped and must commit together, so they run inside a
      // single transaction.
      await db.transaction(async (tx) => {
        await tx
          .update(actionDrafts)
          .set(updatePayload)
          .where(and(eq(actionDrafts.id, id), eq(actionDrafts.orgId, orgId)));

        await tx
          .update(findings)
          .set({ status: "actioned", actionedAt: now })
          .where(and(eq(findings.id, draft.findingId), eq(findings.orgId, orgId)));
      });
    } else {
      await db
        .update(actionDrafts)
        .set(updatePayload)
        .where(and(eq(actionDrafts.id, id), eq(actionDrafts.orgId, orgId)));
    }

    return NextResponse.json({ data: { id, status: targetStatus } }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "action_draft_patch_auth_failed", code: error.code, request_id });
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
            message:
              "Request body is invalid: 'status' must be one of 'approved', 'copied', 'rejected'.",
            details: error.issues,
            request_id,
          },
        },
        { status: 400 },
      );
    }

    console.error({
      event: "action_draft_patch_failed",
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
