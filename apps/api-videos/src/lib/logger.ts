/**
 * api-videos logger. Level comes from the logging policy (@al-ummah/logger/policy):
 * warn on production, stage and QA (only warnings, errors, slow requests); debug locally, overridable with the LOG_LEVEL var.
 */
import { appLogger } from '@al-ummah/logger';

const base = appLogger('api-videos');
const LINE_BREAK: Record<string, string> = { '\r': '\\r', '\n': '\\n', '\u2028': '\\u2028', '\u2029': '\\u2029' };
const singleLine = (message: string) => message.replace(/[\r\n\u2028\u2029]/g, (char) => LINE_BREAK[char]!);

function safeMessage(write: typeof base.error): typeof base.error {
	return (message, data) => write(singleLine(message), data);
}

export const logger = {
	...base,
	trace: safeMessage(base.trace),
	debug: safeMessage(base.debug),
	info: safeMessage(base.info),
	warn: safeMessage(base.warn),
	error: safeMessage(base.error),
};
