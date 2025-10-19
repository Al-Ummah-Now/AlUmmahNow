/**
 * Security tests for A/B testing hash function
 * Validates that the hash function is:
 * 1. Deterministic (same input = same output)
 * 2. Non-gameable (uses SHA-256)
 * 3. Has good distribution
 * 4. Resistant to predictability attacks
 */

import { ABTestingEngine } from '../ab-testing';

describe('ABTestingEngine Security Tests', () => {
  let engine: ABTestingEngine;

  beforeEach(() => {
    engine = ABTestingEngine.getInstance();
  });

  describe('Hash Function Security', () => {
    it('should be deterministic - same input always produces same output', async () => {
      const input = 'user123experiment456';

      // Access private method via type assertion for testing
      const engineAny = engine as any;

      const hash1 = await engineAny.hashUserId(input);
      const hash2 = await engineAny.hashUserId(input);
      const hash3 = await engineAny.hashUserId(input);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it('should produce different hashes for similar inputs (avalanche effect)', async () => {
      const engineAny = engine as any;

      const hash1 = await engineAny.hashUserId('user123');
      const hash2 = await engineAny.hashUserId('user124');
      const hash3 = await engineAny.hashUserId('user123a');

      // Hashes should be significantly different
      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash2).not.toBe(hash3);

      // Check that changing one character produces very different results
      const percentDiff12 = Math.abs(hash1 - hash2) / Math.max(hash1, hash2);
      const percentDiff13 = Math.abs(hash1 - hash3) / Math.max(hash1, hash3);

      // At least 10% difference for avalanche effect
      expect(percentDiff12).toBeGreaterThan(0.1);
      expect(percentDiff13).toBeGreaterThan(0.1);
    });

    it('should have uniform distribution for variant assignment', async () => {
      const engineAny = engine as any;
      const sampleSize = 10000;
      const results = { control: 0, treatment: 0 };

      // Generate hashes for many users and check distribution
      for (let i = 0; i < sampleSize; i++) {
        const hash = await engineAny.hashUserId(`user${i}experiment1`);
        const variant = hash % 2 === 0 ? 'control' : 'treatment';
        results[variant]++;
      }

      // Check that distribution is roughly 50/50 (within 5% tolerance)
      const controlPercentage = (results.control / sampleSize) * 100;
      const treatmentPercentage = (results.treatment / sampleSize) * 100;

      expect(controlPercentage).toBeGreaterThan(45);
      expect(controlPercentage).toBeLessThan(55);
      expect(treatmentPercentage).toBeGreaterThan(45);
      expect(treatmentPercentage).toBeLessThan(55);
    });

    it('should be non-predictable - sequential users get random assignments', async () => {
      const engineAny = engine as any;
      const sequentialResults: boolean[] = [];

      // Check 100 sequential user IDs
      for (let i = 1; i <= 100; i++) {
        const hash = await engineAny.hashUserId(`user${i}experiment1`);
        sequentialResults.push(hash % 2 === 0);
      }

      // Count runs (consecutive same values)
      let runs = 1;
      for (let i = 1; i < sequentialResults.length; i++) {
        if (sequentialResults[i] !== sequentialResults[i - 1]) {
          runs++;
        }
      }

      // For truly random data, expected runs ≈ n/2 ± sqrt(n)
      // For n=100, expected ≈ 50 ± 10
      // If predictable/sequential, would have very few runs
      expect(runs).toBeGreaterThan(30);
      expect(runs).toBeLessThan(70);
    });

    it('should handle traffic allocation consistently', async () => {
      const engineAny = engine as any;
      const experimentId = 'test-experiment';
      const trafficAllocation = 30; // 30% traffic

      let includedCount = 0;
      const totalUsers = 1000;

      for (let i = 0; i < totalUsers; i++) {
        const userId = `user${i}`;
        const hash = await engineAny.hashUserId(userId + experimentId);
        const isInExperiment = hash % 100 < trafficAllocation;

        if (isInExperiment) {
          includedCount++;
        }
      }

      const inclusionPercentage = (includedCount / totalUsers) * 100;

      // Should be close to 30% (within 5% tolerance for this sample size)
      expect(inclusionPercentage).toBeGreaterThan(25);
      expect(inclusionPercentage).toBeLessThan(35);
    });

    it('should resist gaming attempts - cannot predict variant from user ID', async () => {
      const engineAny = engine as any;

      // Attacker tries to find patterns
      const patterns: Record<string, number> = {};

      // Try common patterns attackers might use
      const testPatterns = [
        'admin', 'test', 'user', '123', 'abc',
        'experiment', 'control', 'treatment'
      ];

      for (const pattern of testPatterns) {
        const hash = await engineAny.hashUserId(pattern + 'experiment1');
        patterns[pattern] = hash % 2;
      }

      // No obvious pattern should emerge
      const values = Object.values(patterns);
      const zeros = values.filter(v => v === 0).length;
      const ones = values.filter(v => v === 1).length;

      // Should have mix of both variants, not all same
      expect(zeros).toBeGreaterThan(0);
      expect(ones).toBeGreaterThan(0);
    });

    it('should fallback gracefully when crypto.subtle is unavailable', async () => {
      const engineAny = engine as any;

      // Mock crypto.subtle to be undefined
      const originalCrypto = global.crypto;
      (global as any).crypto = undefined;

      try {
        const hash = await engineAny.hashUserId('test-input');

        // Should still return a valid hash using fallback
        expect(typeof hash).toBe('number');
        expect(hash).toBeGreaterThan(0);

        // Should be deterministic even with fallback
        const hash2 = await engineAny.hashUserId('test-input');
        expect(hash).toBe(hash2);
      } finally {
        // Restore crypto
        (global as any).crypto = originalCrypto;
      }
    });

    it('should handle very long input strings efficiently', async () => {
      const engineAny = engine as any;

      // Create a very long input string
      const longInput = 'user123' + 'x'.repeat(10000) + 'experiment456';

      const startTime = Date.now();
      const hash = await engineAny.hashUserId(longInput);
      const endTime = Date.now();

      // Should complete within reasonable time (< 100ms)
      expect(endTime - startTime).toBeLessThan(100);

      // Should still produce valid hash
      expect(typeof hash).toBe('number');
      expect(hash).toBeGreaterThan(0);

      // Should be deterministic
      const hash2 = await engineAny.hashUserId(longInput);
      expect(hash).toBe(hash2);
    });
  });

  describe('Integration Security', () => {
    it('should prevent variant reassignment after initial assignment', async () => {
      engine.initialize('testuser123');

      const experiment = {
        id: 'security-test',
        name: 'Security Test',
        enabled: true,
        trafficAllocation: 100,
        targetAudience: {},
        startDate: new Date(Date.now() - 86400000).toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
        variants: {
          control: { name: 'Control', config: {} },
          treatment: { name: 'Treatment', config: {} }
        }
      };

      // First assignment
      const result1 = await engine.assignVariant(experiment);

      // Try to get assignment again - should return same variant
      const result2 = await engine.assignVariant(experiment);

      expect(result1.variant).toBe(result2.variant);
      expect(result1.experimentId).toBe(result2.experimentId);
    });

    it('should isolate experiments - same user can have different variants', async () => {
      engine.initialize('testuser456');

      const experiment1 = {
        id: 'exp1',
        name: 'Experiment 1',
        enabled: true,
        trafficAllocation: 100,
        targetAudience: {},
        startDate: new Date(Date.now() - 86400000).toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
        variants: {
          control: { name: 'Control', config: {} },
          treatment: { name: 'Treatment', config: {} }
        }
      };

      const experiment2 = {
        ...experiment1,
        id: 'exp2',
        name: 'Experiment 2'
      };

      const result1 = await engine.assignVariant(experiment1);
      const result2 = await engine.assignVariant(experiment2);

      // Should have assignments for both experiments
      expect(result1.experimentId).toBe('exp1');
      expect(result2.experimentId).toBe('exp2');

      // Variants may or may not be same, but should be independently assigned
      expect(['control', 'treatment']).toContain(result1.variant);
      expect(['control', 'treatment']).toContain(result2.variant);
    });
  });
});