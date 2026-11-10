/**
 * Unified logger for the Next.js web app.
 * - Server: @al-ummah/logger, levelled by the logging policy (production warn,
 *   stage info, QA/dev debug; LOG_LEVEL var overrides).
 * - Browser: lib/logger-client (production hosts show nothing below warn).
 */

import { logger as serverLogger } from './logger-server';
import { logger as clientLogger } from './logger-client';

export const logger = typeof window === 'undefined' ? serverLogger : clientLogger;
