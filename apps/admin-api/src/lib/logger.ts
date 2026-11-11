/**
 * admin-api logger. Level comes from the logging policy (@al-ummah/logger/policy):
 * warn on production, stage and QA (only warnings, errors, slow requests); debug locally, overridable with the LOG_LEVEL var.
 */
import { appLogger } from '@al-ummah/logger';

export const logger = appLogger('admin-api');
