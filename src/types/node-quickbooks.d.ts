/**
 * Minimal ambient type declarations for node-quickbooks@2.0.5.
 *
 * The package ships no TypeScript types and no @types/* package exists on npm.
 * These declarations cover only the surface area consumed by this project.
 *
 * The constructor is called in OAuth 2.0 mode by passing the access_token as
 * the `token` argument and `false` as `tokenSecret`. The extra positional
 * arguments (minorversion, oauthVersion, refreshToken) are accepted by
 * JavaScript but not read by the 2.0.5 constructor — they are typed here as
 * optional so TypeScript does not reject the call site.
 *
 * Methods intentionally omitted: all create/update/delete methods (write
 * access is forbidden per CLAUDE.md), report methods, batch, query, and any
 * other method not directly invoked in this project.
 */
declare module "node-quickbooks" {
  /**
   * Standard node-quickbooks callback. The first argument is an error (or the
   * full response body on an HTTP error from QB); the second is the parsed
   * response body on success.
   */
  type QBCallback<T> = (err: unknown, result: T) => void;

  /**
   * Shape returned by getCompanyInfo().
   * Only the fields used by this project are typed; the QB API returns more.
   */
  interface CompanyInfoResponse {
    CompanyInfo: {
      CompanyName: string;
      LegalName: string;
      Country: string;
      FiscalYearStartMonth?: string;
      Id: string;
      SyncToken: string;
      MetaData: {
        CreateTime: string;
        LastUpdatedTime: string;
      };
    };
    time: string;
  }

  class QuickBooks {
    /**
     * Constructs an authenticated QuickBooks API client.
     *
     * For OAuth 2.0 usage:
     *   - clientId      = QB app client ID
     *   - clientSecret  = QB app client secret
     *   - accessToken   = plaintext OAuth 2.0 access token
     *   - tokenSecret   = false  (unused in OAuth 2.0)
     *   - realmId       = QB company ID
     *   - useSandbox    = true for sandbox environment
     *   - debug         = false in production
     *
     * The remaining parameters (minorversion, oauthVersion, refreshToken) are
     * accepted by the JS runtime but are not read by the 2.0.5 constructor.
     * They are kept in the signature so the call site matches the library's
     * documented OAuth 2.0 usage pattern without TypeScript errors.
     */
    constructor(
      clientId: string,
      clientSecret: string,
      accessToken: string,
      tokenSecret: string | false | null,
      realmId: string,
      useSandbox: boolean,
      debug: boolean,
      minorversion?: null | number,
      oauthVersion?: string,
      refreshToken?: string | null,
    );

    /**
     * Retrieves company information for the connected QuickBooks company.
     * Used for the smoke test (Step 4.4) and for capturing the company name
     * during the OAuth callback (Step 4.3).
     *
     * @param realmId  - The QB company ID (same as the one in the constructor).
     * @param callback - Called with (error, CompanyInfoResponse) on completion.
     */
    getCompanyInfo(realmId: string, callback: QBCallback<CompanyInfoResponse>): void;

    /**
     * Queries the QuickBooks Chart of Accounts.
     * The result is typed as `unknown` here because the concrete account shape
     * (`QBAccount`) is defined locally in the import module that calls this method.
     * Callers must narrow or assert the result type after receiving it.
     *
     * @param criteria - Query criteria object (pass `{}` to fetch all accounts).
     * @param callback - Called with (error, result) where result contains a
     *   `QueryResponse.Account` array on success.
     */
    findAccounts(criteria: Record<string, unknown>, callback: QBCallback<unknown>): void;
  }

  export = QuickBooks;
}
