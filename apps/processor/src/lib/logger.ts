/**
 * processor logger. Level comes from the logging policy (@al-ummah/logger/policy):
 * warn on production, stage and QA (only warnings, errors, slow requests); debug locally, overridable with the LOG_LEVEL var.
 */
import { appLogger, configureLogging, createLogger, type Logger, type LoggingEnv } from '@al-ummah/logger';

export const logger = appLogger('processor');

/**
 * A processor Logger for one invocation: applies the logging policy from the
 * worker's env first (bindings are not in process.env at this compatibility date).
 */
export function loggerFor(env: LoggingEnv): Logger {
  configureLogging(env);
  return createLogger('processor', { forceHttpLogging: true });
}
