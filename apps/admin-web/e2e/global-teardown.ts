/**
 * Dismiss every e2e report still open (pagination seed and anything a failed
 * test left behind) so the QA moderation queue only holds real reports.
 */
import fs from 'node:fs';
import { TOKENS_PATH } from './support/env';
import { closeOpenE2eReports } from './support/api';

export default async function globalTeardown() {
  if (!fs.existsSync(TOKENS_PATH)) return;
  await closeOpenE2eReports();
}
