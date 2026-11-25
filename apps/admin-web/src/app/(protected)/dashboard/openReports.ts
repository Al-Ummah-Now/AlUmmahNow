/** Reports nobody has decided: a report under review is still open. */
export const openReports = (byStatus: Record<string, number>): number => (byStatus.pending ?? 0) + (byStatus.reviewing ?? 0);
