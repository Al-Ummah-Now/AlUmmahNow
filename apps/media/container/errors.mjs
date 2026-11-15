/**
 * The failure reason a container route may answer with: the error's message only (its first line), never
 * the error object or its stack (CodeQL js/stack-trace-exposure, alert #123). The full error stays in the
 * container log.
 */
export function errorReason(error, max = 300) {
	const text = error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';
	const line = String(text).split('\n')[0].trim();
	return (line || 'unknown error').slice(0, max);
}
