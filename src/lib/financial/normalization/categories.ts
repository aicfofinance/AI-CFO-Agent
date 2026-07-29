/**
 * Shared internal category mapping.
 *
 * Maps external accounting system account/description strings to the
 * 15-category internal schema used across all integration sources
 * (QuickBooks, Xero, CSV).
 *
 * The 15 internal categories:
 *   advertising_marketing  contractors        payroll
 *   rent_lease             utilities          insurance
 *   travel                 meals_entertainment office_supplies
 *   software_subscriptions bank_charges       professional_services
 *   taxes_licenses         cost_of_goods_sold revenue
 *
 * Plus the sentinel value `'other'` for any unmapped account.
 * Callers are responsible for logging `'other'` outcomes to `data_quality_log`
 * when a non-null source name was available.
 */

/**
 * Ordered keyword patterns mapped to internal categories.
 *
 * Ordering constraints (must be preserved):
 * - Multi-word phrases before the single keywords they contain.
 * - 'service charge' before 'service' to prevent "Service Charge"
 *   from falling through to 'revenue'.
 * - 'cost of goods' before 'cost' and 'goods'.
 * - 'office supplies' before 'supplies'.
 */
const CATEGORY_PATTERNS: ReadonlyArray<{
  readonly patterns: string[];
  readonly category: string;
}> = [
  { patterns: ["advertising", "marketing"], category: "advertising_marketing" },
  {
    patterns: ["contract labor", "subcontract", "freelance", "contractor"],
    category: "contractors",
  },
  { patterns: ["payroll", "salaries", "salary", "wages", "wage"], category: "payroll" },
  { patterns: ["rent", "lease"], category: "rent_lease" },
  {
    patterns: [
      "utilit",
      "electric",
      "gas and electric",
      "water and sewer",
      "telephone",
      "internet",
    ],
    category: "utilities",
  },
  { patterns: ["insurance"], category: "insurance" },
  { patterns: ["travel", "airfare", "lodging", "hotel"], category: "travel" },
  { patterns: ["meals", "entertainment", "dining", "restaurant"], category: "meals_entertainment" },
  { patterns: ["office supplies", "office supply", "stationery"], category: "office_supplies" },
  {
    patterns: ["software", "subscription", "saas", "computer and internet", "cloud service"],
    category: "software_subscriptions",
  },
  {
    patterns: [
      "bank charge",
      "bank fee",
      "service charge",
      "service fee",
      "merchant fee",
      "processing fee",
      "finance charge",
      "payment processing",
    ],
    category: "bank_charges",
  },
  {
    patterns: ["professional", "legal", "accounting", "audit", "consulting"],
    category: "professional_services",
  },
  { patterns: ["tax", "license", "permit", "registration"], category: "taxes_licenses" },
  {
    patterns: ["cost of goods", "cogs", "cost of sales"],
    category: "cost_of_goods_sold",
  },
  { patterns: ["income", "revenue", "sales", "services"], category: "revenue" },
];

/**
 * Maps any account name or description string to one of the 15 internal
 * transaction categories.
 *
 * Returns `'other'` when the name does not match any known pattern. Callers
 * must log `'other'` to `data_quality_log` when the source name was non-null,
 * so unmapped account names are observable without being silently lost.
 *
 * @param name - An account name, description, or item name from any external
 *   accounting source (QB, Xero, CSV). Case-insensitive matching.
 * @returns One of the 15 internal category strings or `'other'`.
 */
export function mapToInternalCategory(name: string | null | undefined): string {
  if (!name) return "other";
  const lower = name.toLowerCase();
  for (const { patterns, category } of CATEGORY_PATTERNS) {
    for (const pattern of patterns) {
      if (lower.includes(pattern)) return category;
    }
  }
  return "other";
}
