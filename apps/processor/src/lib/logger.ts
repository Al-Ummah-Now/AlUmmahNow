/**
 * processor logger. Level comes from the logging policy (@al-ummah/logger/policy):
 * production warn, stage info, QA/dev debug, overridable with the LOG_LEVEL var.
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
