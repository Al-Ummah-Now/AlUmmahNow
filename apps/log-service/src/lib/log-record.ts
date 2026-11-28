import { z } from 'zod';

export const LOG_APP_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export const logLevel = z.string().regex(/^(trace|debug|info|warn|error)$/i);
export const logEntry = z.object({
  app: z.string().regex(LOG_APP_NAME),
  level: logLevel,
  message: z.string().max(65_536),
  data: z.unknown().optional(),
});

export function formatLogLine({ level, message, data }: z.infer<typeof logEntry>): string {
  const safeMessage = message.replace(/[\p{Cc}\u2028\u2029]/gu, (char) => char === '\n' ? '\\n' : '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  const details = data ? ' ' + JSON.stringify(data) : '';
  return '[' + new Date().toISOString() + '] [' + level.toUpperCase() + '] ' + safeMessage + details + '\n';
}
