// Invoice acceleration template — collections_opportunity findings.
//
// Pure prompt builder: takes the `related_data` subset for a collections finding
// and returns the { system, user } prompt pair. It performs NO AI calls, NO DB
// access, and NO arithmetic on monetary string values (CLAUDE.md: never sum
// DECIMAL-as-string amounts in JavaScript). When there are multiple invoices the
// prompt lists them by number rather than computing a total.

type Invoice = {
  invoiceId: string;
  amount: string; // DECIMAL as string — never parsed to a number here
  clientName: string;
  daysOutstanding: number;
};

type InvoiceAccelerationInput = {
  invoices: Invoice[];
};

type PromptPair = { system: string; user: string };

const SYSTEM_PROMPT =
  "You are a professional business communication assistant helping a small " +
  "business owner follow up on overdue invoices. Write in a polite but firm " +
  "tone. Be concise — 80-120 words in the email body. Never include a subject " +
  "line in the body. Do not use placeholder text like [Your name] — use 'Best " +
  "regards,' as the closing.";

/**
 * Builds the invoice-acceleration prompt pair. The single-invoice case names the
 * exact amount and days overdue; the multi-invoice case reports the count and the
 * oldest overdue age without summing amounts (no JavaScript monetary arithmetic).
 * Invoice reference numbers are always listed so the recipient can reconcile.
 */
export function buildInvoiceAccelerationPrompt(input: InvoiceAccelerationInput): PromptPair {
  const { invoices } = input;
  const firstInvoice = invoices[0];

  // Defensive: the intelligence engine always populates at least one invoice for
  // a collections_opportunity finding, but a partial payload must not throw.
  const clientName = firstInvoice?.clientName ?? "your client";
  const invoiceIds = invoices.map((invoice) => invoice.invoiceId).join(", ");

  let summary: string;
  if (invoices.length === 1 && firstInvoice) {
    summary =
      `an outstanding invoice of $${firstInvoice.amount} ` +
      `(${firstInvoice.daysOutstanding} days overdue)`;
  } else {
    const oldestDays = invoices.reduce(
      (max, invoice) => (invoice.daysOutstanding > max ? invoice.daysOutstanding : max),
      0,
    );
    summary = `outstanding invoices (${invoices.length} invoices, ${oldestDays} days overdue)`;
  }

  const user =
    `Write a collections follow-up email to ${clientName} regarding ${summary}. ` +
    `Reference the following invoice number(s): ${invoiceIds}. ` +
    `Politely request payment and offer to resolve any billing questions.`;

  return { system: SYSTEM_PROMPT, user };
}
