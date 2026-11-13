/**
 * short-links logger. Level comes from the logging policy (@al-ummah/logger/policy):
 * production warn, overridable with the LOG_LEVEL var.
 */
import { appLogger } from '@al-ummah/logger';

export const logger = appLogger('short-links');
