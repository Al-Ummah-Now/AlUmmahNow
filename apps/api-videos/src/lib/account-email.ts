/**
 * The email a user's profile carries: the signed-in account's, from the verified
 * token. Older clients still send `email` with a profile; it is never stored.
 */

/** The signed-in token's email, trimmed and lower-cased; null when it has none. */
export function tokenEmail(auth: { email?: string } | null | undefined): string | null {
	const email = auth?.email?.trim().toLowerCase();
	return email || null;
}

/**
 * A submitted profile with the account's email in place of the submitted one.
 * Without a token email the key is absent, so a stored email stays as it is.
 */
export function withAccountEmail<T extends { email?: unknown }>(input: T, auth: { email?: string } | null | undefined): Omit<T, 'email'> & { email?: string } {
	const { email: _ignored, ...fields } = input;
	const email = tokenEmail(auth);
	return email ? { ...fields, email } : fields;
}
