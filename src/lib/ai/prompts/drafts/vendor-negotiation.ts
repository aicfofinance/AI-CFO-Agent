// Vendor negotiation template — margin_alert findings.
//
// Pure prompt builder for a professional email requesting a pricing conversation
// with a vendor. Injects the margin decline (in percentage points) as internal
// context only — the exact margin figures are deliberately NOT included in the
// prompt because they are sensitive internal business data. Performs NO AI calls,
// NO DB access, and NO arithmetic on monetary string values.

type VendorNegotiationInput = {
  currentMargin: number;
  priorYearMargin: number;
  declinePoints: number;
  // Vendor name comes from the finding headline for margin_alert; optional
  // because a margin_alert may not always name a single vendor.
  vendorContext?: string;
};

type PromptPair = { system: string; user: string };

const SYSTEM_PROMPT =
  "You are a professional business communication assistant helping a business " +
  "owner negotiate better pricing with vendors. Write 100-150 words. Be " +
  "professional, acknowledge the existing relationship, and focus on a future " +
  "conversation — not a demand. Request a pricing call, not immediate discounts.";

/**
 * Builds the vendor-negotiation prompt pair. The prompt frames the outreach
 * around "reviewing our cost structure" and asks to schedule a pricing call. The
 * margin decline is passed only as directional context (how many percentage
 * points margin dropped); the raw `currentMargin` and `priorYearMargin` values
 * are intentionally omitted so they never leak into an outbound email.
 */
export function buildVendorNegotiationPrompt(input: VendorNegotiationInput): PromptPair {
  const trimmedContext = input.vendorContext?.trim() ?? "";
  const recipient = trimmedContext.length > 0 ? trimmedContext : "a key vendor";

  const user =
    `Write an email to ${recipient} requesting a call to discuss pricing. ` +
    `Internal context (do not quote these figures in the email): we have been ` +
    `reviewing our cost structure and our gross margin has dropped by ` +
    `${input.declinePoints} percentage points. Acknowledge the existing ` +
    `relationship, explain that we are reviewing our cost structure, and ask to ` +
    `schedule a pricing call. Do not demand a discount and do not state any ` +
    `specific margin or financial figures.`;

  return { system: SYSTEM_PROMPT, user };
}
