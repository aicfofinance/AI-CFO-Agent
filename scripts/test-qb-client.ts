/**
 * Smoke test: QuickBooks OAuth client instantiation.
 *
 * Verifies that createOAuthClient() executes without throwing when
 * QB credentials are present in the environment.
 *
 * Usage:
 *   pnpm tsx scripts/test-qb-client.ts
 *
 * Expected output:
 *   QB OAuth client created successfully.
 *   Environment: sandbox
 *   Authorize endpoint: https://appcenter.intuit.com/connect/oauth2
 *   Client ID prefix: <first 8 chars of client ID>...
 *
 * This script is a development utility only. It is never imported by
 * application code and is not deployed.
 */

import "./load-env";
import { createOAuthClient } from "@/lib/integrations/quickbooks/auth";
import OAuthClient from "intuit-oauth";

function main(): void {
  console.log("Testing QuickBooks OAuth client instantiation...\n");

  let client: OAuthClient;
  try {
    client = createOAuthClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("FAIL: createOAuthClient() threw:", message);
    process.exit(1);
  }

  // Verify the client has the expected static scope constants available,
  // confirming the intuit-oauth module loaded correctly.
  const accountingScope = OAuthClient.scopes.Accounting;
  const env = (client as unknown as { environment: string }).environment;
  const clientId = (client as unknown as { clientId: string }).clientId;

  console.log("QB OAuth client created successfully.");
  console.log(`Environment:          ${env}`);
  console.log(`Accounting scope:     ${accountingScope}`);
  console.log(`Client ID prefix:     ${clientId.slice(0, 8)}...`);
  console.log("\nStep 4.0 Definition of Done: PASS");
}

main();
