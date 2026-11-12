/**
 * Runs whatever happened in the specs: dismiss every e2e report of this job
 * still open (pagination seed and anything a failed test left behind), then
 * delete everything the job created (support/cleanup.ts: on the local stack
 * the reports and audit rows too, and every run account's data and account).
 */
import fs from 'node:fs';
import { TOKENS_PATH } from './support/env';
import { closeOpenE2eReports } from './support/api';
import { teardownRun } from './support/cleanup';

export default async function globalTeardown() {
  let reportsError: unknown;
  if (fs.existsSync(TOKENS_PATH)) await closeOpenE2eReports().catch((error) => { reportsError = error; });
  await teardownRun((line) => console.log(line));
  if (reportsError) throw reportsError;
}
