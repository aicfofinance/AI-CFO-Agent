/**
 * Smoke test: QuickBooks API client factory (Step 4.4).
 *
 * Verifies that `getQuickBooksClient(connectionId)` decrypts stored tokens,
 * instantiates a node-quickbooks client, and successfully calls
 * `qbo.getCompanyInfo()` against the QuickBooks sandbox API.
 *
 * Prerequisites:
 *   1. A valid QuickBooks sandbox connection must exist in the database.
 *   2. The connection's `access_token_encrypted` and `refresh_token_encrypted`
 *      columns must contain AES-256-GCM ciphertext written by `encryptToken()`.
 *   3. All required environment variables must be set in `.env.local`:
 *        QB_CLIENT_ID, QB_CLIENT_SECRET, QB_ENVIRONMENT=sandbox
 *        DATABASE_URL, OAUTH_ENCRYPTION_KEY
 *
 * Usage:
 *   pnpm tsx scripts/test-qb-client.ts <connectionId>
 *
 * Where <connectionId> is the UUID primary key of a `connections` row with
 * provider='quickbooks' and a valid, non-expired token pair.
 *
 * Expected output (on success):
 *   Calling getCompanyInfo for realm: <realmId>
 *   Company name: <YourSandboxCompanyName>
 *   Step 4.4 Definition of Done: PASS
 *
 * This script is a development utility only. It is never imported by
 * application code and is not deployed.
 */

import "./load-env";

import { getQuickBooksClient } from "@/lib/integrations/quickbooks/client";

async function main(): Promise<void> {
  const connectionId = process.argv[2];

  if (!connectionId) {
    console.error("Usage: pnpm tsx scripts/test-qb-client.ts <connectionId>");
    console.error("  <connectionId> is the UUID of a connections row with provider='quickbooks'");
    process.exit(1);
  }

  console.log(`Testing QB client factory for connection: ${connectionId}\n`);

  let qbo: Awaited<ReturnType<typeof getQuickBooksClient>>;

  try {
    qbo = await getQuickBooksClient(connectionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("FAIL: getQuickBooksClient() threw:", message);
    process.exit(1);
  }

  // Access the realmId stored on the client instance.
  // node-quickbooks stores it as `qbo.realmId` (set in the constructor).
  const realmId = (qbo as unknown as { realmId: string }).realmId;

  console.log(`Calling getCompanyInfo for realm: ${realmId}`);

  await new Promise<void>((resolve, reject) => {
    qbo.getCompanyInfo(realmId, (err, companyInfo) => {
      if (err) {
        reject(new Error(typeof err === "object" ? JSON.stringify(err) : String(err)));
        return;
      }

      console.log(`Company name:  ${companyInfo.CompanyInfo.CompanyName}`);
      console.log(`Legal name:    ${companyInfo.CompanyInfo.LegalName}`);
      console.log(`Country:       ${companyInfo.CompanyInfo.Country}`);
      console.log(`Company ID:    ${companyInfo.CompanyInfo.Id}`);
      console.log(`Last updated:  ${companyInfo.CompanyInfo.MetaData.LastUpdatedTime}`);
      resolve();
    });
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("FAIL: getCompanyInfo() returned an error:", message);
    process.exit(1);
  });

  console.log("\nStep 4.4 Definition of Done: PASS");
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
