// Subscription cancellation template — duplicate_subscription findings.
//
// Pure prompt builder for a vendor inquiry about two subscription charges that
// look like duplicates. Injects the vendor name, both transaction amounts, and
// both account names. Performs NO AI calls, NO DB access, and NO arithmetic on
// monetary string values.

type SubscriptionCancellationInput = {
  vendorName: string;
  transaction1Amount: string; // DECIMAL as string
  transaction1Id: string;
  account1Name: string;
  transaction2Amount: string; // DECIMAL as string
  transaction2Id: string;
  account2Name: string;
};

type PromptPair = { system: string; user: string };

const SYSTEM_PROMPT =
  "You are a professional business communication assistant. Write a concise, " +
  "polite inquiry email to a vendor. Be direct but courteous. 60-90 words in " +
  "the email body.";

/**
 * Builds the subscription-cancellation inquiry prompt pair. The email asks the
 * vendor to confirm whether both subscriptions are intentional and, if they are
 * duplicates, requests guidance on consolidating them. Both charges are described
 * by their amount and originating account so the vendor can locate them.
 */
export function buildSubscriptionCancellationPrompt(
  input: SubscriptionCancellationInput,
): PromptPair {
  const user =
    `Write an inquiry email to ${input.vendorName} about two subscription ` +
    `charges that appear to be duplicates. The first charge is ` +
    `$${input.transaction1Amount} on the "${input.account1Name}" account ` +
    `(reference ${input.transaction1Id}). The second charge is ` +
    `$${input.transaction2Amount} on the "${input.account2Name}" account ` +
    `(reference ${input.transaction2Id}). Ask whether both subscriptions are ` +
    `intentional, and if they are duplicates, request guidance on consolidating ` +
    `them into a single subscription.`;

  return { system: SYSTEM_PROMPT, user };
}
