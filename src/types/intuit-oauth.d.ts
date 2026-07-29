/**
 * Minimal ambient type declarations for intuit-oauth@4.0.0.
 *
 * The package ships no TypeScript types and no @types/* package exists.
 * These declarations cover the surface area used by this project:
 *   - OAuthClient constructor + config
 *   - authorizeUri()         — OAuth 2.0 PKCE redirect URL builder
 *   - createToken()          — Exchange authorization code for tokens
 *   - refresh() / refreshUsingToken() — Token refresh (QB tokens rotate on each refresh)
 *   - revoke()               — Revoke access or refresh token
 *   - getToken()             — Inspect current token state
 *   - Static scopes / environment constants
 *
 * Fields intentionally omitted: getUserInfo(), validateIdToken(), makeApiCall(),
 * getKeyFromJWKsURI(), setAuthorizeURLs() — not consumed by this project.
 */
declare module "intuit-oauth" {
  interface OAuthClientConfig {
    clientId: string;
    clientSecret: string;
    environment: "sandbox" | "production";
    redirectUri: string;
    logging?: boolean;
    token?: Partial<TokenParams>;
  }

  interface TokenParams {
    realmId: string;
    token_type: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
    id_token?: string;
    latency?: number;
    createdAt?: number;
  }

  class Token {
    realmId: string;
    token_type: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
    id_token: string;
    latency: number;
    createdAt: number;

    isAccessTokenValid(): boolean;
    getToken(): TokenParams;
    setToken(params: Partial<TokenParams>): void;
    clearToken(): void;
  }

  class AuthResponse {
    status: number;
    getJson(): Record<string, unknown>;
    valid(): boolean;
    getToken(): Token;
    text(): string;
  }

  interface AuthorizeUriParams {
    scope: string | string[];
    state?: string;
  }

  interface RevokeParams {
    access_token?: string;
    refresh_token?: string;
  }

  class OAuthClient {
    static readonly environment: {
      readonly sandbox: string;
      readonly production: string;
    };

    static readonly scopes: {
      readonly Accounting: string;
      readonly Payment: string;
      readonly Payroll: string;
      readonly TimeTracking: string;
      readonly Benefits: string;
      readonly Profile: string;
      readonly Email: string;
      readonly Phone: string;
      readonly Address: string;
      readonly OpenId: string;
      readonly Intuit_name: string;
    };

    constructor(config: OAuthClientConfig);

    authorizeUri(params: AuthorizeUriParams): string;
    createToken(uri: string): Promise<AuthResponse>;
    refresh(): Promise<AuthResponse>;
    refreshUsingToken(refreshToken: string): Promise<AuthResponse>;
    revoke(params?: RevokeParams): Promise<AuthResponse>;
    getToken(): Token;
    setToken(params: Partial<TokenParams>): this;
    isAccessTokenValid(): boolean;
    validateToken(): void;
  }

  export = OAuthClient;
}
