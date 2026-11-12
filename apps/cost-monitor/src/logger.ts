/**
 * cost-monitor logger. Level comes from the logging policy (@al-ummah/logger/policy):
 * production warn, stage info, QA/dev debug, overridable with the LOG_LEVEL var.
 */
import { appLogger } from '@al-ummah/logger';

export const logger = appLogger('cost-monitor');
