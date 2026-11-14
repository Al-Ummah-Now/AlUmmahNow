/**
 * Whether an OpenAuth `client.verify()` result failed. Any `err` is a failure: openauth's errors
 * (InvalidAccessTokenError, InvalidSubjectError, InvalidRefreshTokenError) are Error subclasses
 * whose only own property, `message`, is not enumerable, so `Object.keys(err).length > 0` is
 * always false and must never be used as the test. A result without a subject is a failure too.
 */
export function verificationFailed(result: { err?: unknown; subject?: unknown } | null | undefined): boolean {
  if (!result) return true;
  if (result.err) return true;
  return !('subject' in result) || !result.subject;
}

/**
 * The user id an access token PROVES (signature, issuer, expiry via `verify`), or null. The web
 * session cookie is plain JSON the browser can edit, so its `userId` is never vouched for on its
 * own (e.g. as X-Client-User-Id to admin-api's error ingest): only the verified token's subject.
 */
export async function verifiedUserId(
  accessToken: string | null | undefined,
  verify: (token: string) => Promise<{ err?: unknown; subject?: { properties?: { id?: unknown } } }>,
): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const result = await verify(accessToken);
    if (verificationFailed(result)) return null;
    const id = result.subject?.properties?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}
