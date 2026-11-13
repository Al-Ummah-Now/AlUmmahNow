import { withinBudget } from '../first-data';

describe('withinBudget', () => {
  it('should return the value when it loads within the budget', async () => {
    await expect(withinBudget(async () => ({ ok: 1 }), 50)).resolves.toEqual({ ok: 1 });
  });

  it('should return undefined when the load fails', async () => {
    await expect(withinBudget(async () => { throw new Error('down'); }, 50)).resolves.toBeUndefined();
  });

  it('should return undefined when the load answers null', async () => {
    await expect(withinBudget(async () => null, 50)).resolves.toBeUndefined();
  });

  it('should return undefined when the load takes longer than the budget', async () => {
    jest.useFakeTimers();
    try {
      const pending = withinBudget(() => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000)), 100);
      await jest.advanceTimersByTimeAsync(150);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
