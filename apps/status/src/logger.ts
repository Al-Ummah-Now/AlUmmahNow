/**
 * status logger. Level comes from the logging policy (@al-ummah/logger/policy):
 * warn on every deployed env, overridable with the LOG_LEVEL var.
 */
import { appLogger } from '@al-ummah/logger';

export const logger = appLogger('status');
