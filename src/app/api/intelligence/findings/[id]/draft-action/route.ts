import { generateText } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { detectRateLimitError, getModel } from "@/lib/ai/models/router";
import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { actionDrafts, findings } from "@/lib/platform/db/schema";

/**
 * Maps a finding type to the `action_drafts.action_type` value it produces. Only
 * these three finding types support draft generation in V1:
 * - `collections_opportunity` → invoice acceleration email
 * - `duplicate_subscription`  → subscription cancellation inquiry
 * - `margin_alert`            → vendor negotiation request
 *
 * `cash_flow_risk` and `anomaly` deliberately have no template and return 422.
 * A lookup miss (undefined) is the single source of truth for "not draftable".
 */
const DRAFT_ACTION_TYPES = {
  collections_opportunity: "invoice_acceleration",
  duplicate_subscription: "subscription_cancellation",
  margin_alert: "vendor_negotiation",
} as const;

type DraftableFindingType = keyof typeof DRAFT_ACTION_TYPES;
type DraftActionType = (typeof DRAFT_ACTION_TYPES)[DraftableFindingType];

/**
 * Returns the mapped `action_type` for a draftable finding type, or `undefined`
 * when the finding type has no draft template. Written as explicit comparisons
 * (rather than an index lookup) so the return type is exact under
 * `noUncheckedIndexedAccess` without any cast.
 */
function resolveActionType(findingType: string): DraftActionType | undefined {
  if (findingType === "collections_opportunity") {
    return DRAFT_ACTION_TYPES.collections_opportunity;
  }
  if (findingType === "duplicate_subscription") {
    return DRAFT_ACTION_TYPES.duplicate_subscription;
  }
  if (findingType === "margin_alert") {
    return DRAFT_ACTION_TYPES.margin_alert;
  }
  return undefined;
}

/**
 * Prepended to every stored draft body. The review UI (Step 9.3+) renders this
 * as a visible banner, but it is persisted with the content so the disclaimer is
 * never lost regardless of where the draft is displayed (CLAUDE.md: every
 * AI-generated email draft must display the draft disclaimer, never opt-in).
 */
const DRAFT_DISCLAIMER = "[AI Draft — Review before sending]";

const DRAFT_SYSTEM_PROMPT =
  "You are a professional business communication assistant helping a business " +
  "owner draft a concise, professional email based on their accounting data.";

type CollectionsRelatedData = {
  invoices?: Array<{
    clientName?: string;
    amount?: string;
    daysOutstanding?: number;
    invoiceId?: string;
  }>;
};

type DuplicateRelatedData = {
  vendorName?: string;
  transaction1Amount?: string;
  transaction2Amount?: string;
};

type DraftSpec = {
  subjectLine: string;
  recipientEmail: string | null;
  userPrompt: string;
};

/**
 * Builds the subject line, recipient, and model prompt for a draftable finding.
 * The `related_data` shape is finding-type specific; each branch reads only the
 * fields it needs and falls back to safe defaults for missing values (the
 * intelligence engine populates these, but a partial payload must not throw).
 */
function buildDraftSpec(
  findingType: DraftableFindingType,
  relatedData: Record<string, unknown>,
): DraftSpec {
  if (findingType === "collections_opportunity") {
    const invoices = (relatedData as CollectionsRelatedData).invoices ?? [];
    const clientName = invoices[0]?.clientName ?? "your client";
    const totalAmount = invoices[0]?.amount ?? "0.00";
    return {
      subjectLine: `Following up on outstanding invoice — ${clientName}`,
      recipientEmail: null,
      userPrompt:
        `Draft a 80-100 word professional email to ${clientName} following up on an ` +
        `outstanding invoice of $${totalAmount} that is overdue. Be polite but direct. ` +
        `Ask them to remit payment or contact us if there is an issue.`,
    };
  }

  if (findingType === "duplicate_subscription") {
    const data = relatedData as DuplicateRelatedData;
    const vendorName = data.vendorName ?? "a vendor";
    return {
      subjectLine: `Question about our subscriptions — ${vendorName}`,
      recipientEmail: null,
      userPrompt:
        `Draft a 60-80 word professional email to ${vendorName} asking about what appears ` +
        `to be a duplicate subscription charge across two accounts. Ask for clarification ` +
        `on whether both subscriptions are necessary.`,
    };
  }

  // margin_alert — the vendor negotiation prompt is generic and does not read
  // finding-specific fields, so `relatedData` is intentionally unused here.
  void relatedData;
  return {
    subjectLine: "Request to discuss pricing — exploring cost reduction opportunities",
    recipientEmail: null,
    userPrompt:
      `Draft a 80-100 word professional email to a key vendor asking to schedule a call to ` +
      `discuss our current pricing arrangement. Reference that we've been a long-standing ` +
      `customer and are looking to review costs. Be professional and forward-looking.`,
  };
}

/**
 * POST /api/intelligence/findings/:id/draft-action
 *
 * Requires session. Generates (or returns the existing) agentic email draft for a
 * finding and stores it as an `action_drafts` row with `status = 'draft'`.
 *
 * Status codes:
 * - 201 draft created (or 200-shaped 201 when an existing draft is returned)
 * - 401 unauthenticated / 403 no org membership (via getRequestContext)
 * - 404 finding not found in the caller's org (a cross-org id never matches, so
 *   its existence is never leaked — CLAUDE.md Multi-tenancy Rules)
 * - 409 finding is not `active`
 * - 422 finding type has no draft template (`cash_flow_risk`, `anomaly`)
 * - 503 AI provider rate limited (HTTP 429) — never retried, never failed over
 * - 500 unexpected error / missing org context
 *
 * The org is always sourced from `getRequestContext()`, never from user input,
 * and every `findings`/`action_drafts` query is org-scoped.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId, userId } = await getRequestContext(request);
    const { id } = await params;

    // Org-scoped lookup: a finding in another org yields no row → 404 that does
    // not reveal whether the finding exists elsewhere.
    const [finding] = await db
      .select({
        id: findings.id,
        findingType: findings.findingType,
        status: findings.status,
        relatedData: findings.relatedData,
      })
      .from(findings)
      .where(and(eq(findings.id, id), eq(findings.orgId, orgId)))
      .limit(1);

    if (!finding) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Finding not found.", request_id } },
        { status: 404 },
      );
    }

    if (finding.status !== "active") {
      return NextResponse.json(
        {
          error: {
            code: "FINDING_NOT_ACTIVE",
            message: "This finding is not active and cannot generate a draft.",
            request_id,
          },
        },
        { status: 409 },
      );
    }

    const actionType = resolveActionType(finding.findingType);
    if (!actionType) {
      return NextResponse.json(
        {
          error: {
            code: "DRAFT_NOT_SUPPORTED",
            message: "This finding type does not support draft generation.",
            request_id,
          },
        },
        { status: 422 },
      );
    }
    const findingType: DraftableFindingType = finding.findingType as DraftableFindingType;

    // Idempotency: if an in-flight draft already exists for this finding, return
    // it rather than generating (and paying for) another. Scoped to the org.
    const [existing] = await db
      .select({
        id: actionDrafts.id,
        draftContent: actionDrafts.draftContent,
        subjectLine: actionDrafts.subjectLine,
        recipientEmail: actionDrafts.recipientEmail,
      })
      .from(actionDrafts)
      .where(
        and(
          eq(actionDrafts.findingId, finding.id),
          eq(actionDrafts.orgId, orgId),
          inArray(actionDrafts.status, ["draft", "approved"]),
        ),
      )
      .limit(1);

    if (existing) {
      return NextResponse.json(
        {
          data: {
            draftId: existing.id,
            draftContent: existing.draftContent,
            subjectLine: existing.subjectLine,
            recipientEmail: existing.recipientEmail,
          },
        },
        { status: 201 },
      );
    }

    const spec = buildDraftSpec(findingType, finding.relatedData);

    // Draft generation is not a complex financial analysis task — default
    // complexity 0.5 routes to the routine model (CLAUDE.md: no escalation
    // without specific justification). Never import a provider directly.
    let generatedText: string;
    let tokensUsed: number | null;
    try {
      const result = await generateText({
        model: getModel(0.5),
        system: DRAFT_SYSTEM_PROMPT,
        prompt: spec.userPrompt,
      });
      generatedText = result.text;
      tokensUsed = result.usage.totalTokens ?? null;
    } catch (aiError) {
      // HTTP 429: surface as 503, never retry, never fail over to another
      // provider (CLAUDE.md AI Integration Rules).
      if (detectRateLimitError(aiError)) {
        console.error({ event: "draft_action_rate_limited", orgId, findingId: id, request_id });
        return NextResponse.json(
          {
            error: {
              code: "AI_RATE_LIMITED",
              message: "AI provider is rate limited. Please try again shortly.",
              request_id,
            },
          },
          { status: 503 },
        );
      }

      console.error({
        event: "draft_action_ai_failed",
        orgId,
        findingId: id,
        errorMessage: aiError instanceof Error ? aiError.message : String(aiError),
        request_id,
      });
      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred while generating the draft.",
            request_id,
          },
        },
        { status: 500 },
      );
    }

    const draftContent = `${DRAFT_DISCLAIMER}\n\n${generatedText}`;

    const [draft] = await db
      .insert(actionDrafts)
      .values({
        orgId,
        userId,
        findingId: finding.id,
        actionType,
        draftContent,
        subjectLine: spec.subjectLine,
        recipientEmail: spec.recipientEmail,
        tokensUsed,
        status: "draft",
      })
      .returning({ id: actionDrafts.id });

    if (!draft) {
      console.error({ event: "draft_action_insert_failed", orgId, findingId: id, request_id });
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

    return NextResponse.json(
      {
        data: {
          draftId: draft.id,
          draftContent,
          subjectLine: spec.subjectLine,
          recipientEmail: spec.recipientEmail,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "draft_action_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "draft_action_failed",
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
