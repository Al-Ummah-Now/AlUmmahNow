/**
 * Hook point for revoking an account's tokens at the issuer when it signs out
 * of this app.
 *
 * The issuer has no token revocation endpoint yet, so this does nothing today:
 * signing out only removes the tokens from this browser's session cookie, and a
 * copied refresh token stays valid until it expires. When the issuer gains
 * `/token/revoke`, call it here (best effort: a failure must never block
 * signing out). Every sign-out path that drops tokens goes through this.
 */

export interface RevocableTokens {
  userId: string;
  refreshToken: string;
}

export async function revokeTokensOnSignOut(accounts: RevocableTokens[]): Promise<void> {
  void accounts;
}
