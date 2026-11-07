import { test as base } from '@playwright/test';
import { createReport, dismissReport, getReport, type AdminReport, type CreateReportOptions } from './api';

interface Fixtures {
  /** Create a report for this test; it is dismissed afterwards if still open. */
  makeReport: (options?: CreateReportOptions) => Promise<AdminReport>;
}

export const test = base.extend<Fixtures>({
  makeReport: async ({}, use) => {
    const created: string[] = [];
    await use(async (options) => {
      const report = await createReport(options);
      created.push(report.id);
      return report;
    });
    for (const id of created) {
      const report = await getReport(id).catch(() => null);
      if (report && (report.status === 'pending' || report.status === 'reviewing')) {
        await dismissReport(id);
      }
    }
  },
});

export { expect } from '@playwright/test';
