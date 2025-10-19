import { Experiment, ExperimentAssignment } from './feature-flags';
import { trackExperimentEvent } from './analytics';
import { quotaManager } from '@/lib/storage/quota-manager';

export interface ExperimentResult {
  variant: 'control' | 'treatment';
  assignmentTime: number;
  experimentId: string;
}

export interface StatisticalData {
  controlConversions: number;
  treatmentConversions: number;
  controlVisitors: number;
  treatmentVisitors: number;
  pValue: number;
  isSignificant: boolean;
  confidenceLevel: number;
}

const MIN_SAMPLE_SIZE = 100;
const SIGNIFICANCE_THRESHOLD = 0.05;

const STORAGE_KEY_AB_ASSIGNMENTS = 'al-ummah-ab-assignments';

export class ABTestingEngine {
  private static instance: ABTestingEngine;
  private assignments: Map<string, ExperimentAssignment> = new Map();
  private userId: string | null = null;

  private constructor() {}

  static getInstance(): ABTestingEngine {
    if (!ABTestingEngine.instance) {
      ABTestingEngine.instance = new ABTestingEngine();
    }
    return ABTestingEngine.instance;
  }

  initialize(userId: string): void {
    this.userId = userId;
    this.loadPersistedAssignments();

    // Perform maintenance on initialization
    this.performMaintenance();
  }

  private loadPersistedAssignments(): void {
    try {
      if (typeof window === 'undefined') return;

      const persisted = quotaManager.safeGetItem(STORAGE_KEY_AB_ASSIGNMENTS);
      if (persisted && this.userId) {
        const userAssignments = JSON.parse(persisted);
        if (userAssignments[this.userId]) {
          this.assignments = new Map(Object.entries(userAssignments[this.userId]));

          // Update last accessed time for all loaded assignments
          for (const experimentId of this.assignments.keys()) {
            quotaManager.updateLastAccessed(
              STORAGE_KEY_AB_ASSIGNMENTS,
              this.userId,
              experimentId
            );
          }
        }
      }
    } catch (error) {
      console.warn('[ABTesting] Failed to load persisted assignments:', error);
      // Graceful degradation: continue without persisted data
    }
  }

  private persistAssignments(): void {
    try {
      if (typeof window === 'undefined' || !this.userId) return;

      const persisted = quotaManager.safeGetItem(STORAGE_KEY_AB_ASSIGNMENTS) || '{}';
      const allAssignments = JSON.parse(persisted);
      allAssignments[this.userId] = Object.fromEntries(this.assignments);

      const serialized = JSON.stringify(allAssignments);
      const result = quotaManager.safeSetItem(
        STORAGE_KEY_AB_ASSIGNMENTS,
        serialized,
        {
          userId: this.userId,
          maxUserItems: 100, // Max 100 experiments per user
          enableCleanup: true
        }
      );

      if (!result.success) {
        console.error('[ABTesting] Failed to persist assignments:', result.error, result.message);

        // Attempt recovery by removing old assignments for this user
        if (result.error === 'QUOTA_EXCEEDED') {
          this.performEmergencyCleanup();

          // Retry once after cleanup
          const retryResult = quotaManager.safeSetItem(
            STORAGE_KEY_AB_ASSIGNMENTS,
            serialized,
            { userId: this.userId }
          );

          if (!retryResult.success) {
            console.error('[ABTesting] Retry failed after emergency cleanup');
          }
        }
      }
    } catch (error) {
      console.error('[ABTesting] Error persisting assignments:', error);
      // Graceful degradation: assignments remain in memory
    }
  }

  async assignVariant(experiment: Experiment): Promise<ExperimentResult> {
    if (!this.userId) {
      throw new Error('ABTestingEngine not initialized with userId');
    }

    if (!experiment.enabled) {
      throw new Error(`Experiment ${experiment.id} is not enabled`);
    }

    const existingAssignment = this.assignments.get(experiment.id);
    if (existingAssignment) {
      return {
        variant: existingAssignment.variant,
        assignmentTime: existingAssignment.assignmentTime,
        experimentId: experiment.id
      };
    }

    const hash = await this.hashUserId(this.userId + experiment.id);
    const isInExperiment = hash % 100 < experiment.trafficAllocation;

    if (!isInExperiment) {
      throw new Error(`User not in experiment ${experiment.id} traffic allocation`);
    }

    const variantHash = await this.hashUserId(this.userId + experiment.id + 'variant');
    const variant = variantHash % 2 === 0 ? 'control' : 'treatment';

    const assignment: ExperimentAssignment = {
      variant,
      assignmentTime: Date.now(),
      experimentId: experiment.id
    };

    this.assignments.set(experiment.id, assignment);
    this.persistAssignments();

    trackExperimentEvent({
      eventType: 'assignment',
      experimentId: experiment.id,
      variant,
      userId: this.userId,
      timestamp: assignment.assignmentTime
    });

    return {
      variant,
      assignmentTime: assignment.assignmentTime,
      experimentId: experiment.id
    };
  }

  getVariant(experimentId: string): 'control' | 'treatment' | null {
    const assignment = this.assignments.get(experimentId);

    // Update last accessed time for LRU tracking
    if (assignment && this.userId) {
      quotaManager.updateLastAccessed(
        STORAGE_KEY_AB_ASSIGNMENTS,
        this.userId,
        experimentId
      );
    }

    return assignment ? assignment.variant : null;
  }

  trackConversion(experimentId: string, conversionValue?: number): void {
    const assignment = this.assignments.get(experimentId);
    if (!assignment || !this.userId) {
      console.warn(`No assignment found for experiment ${experimentId}`);
      return;
    }

    trackExperimentEvent({
      eventType: 'conversion',
      experimentId,
      variant: assignment.variant,
      userId: this.userId,
      timestamp: Date.now(),
      conversionValue
    });
  }

  calculateStatisticalSignificance(data: StatisticalData): StatisticalData {
    const { controlConversions, treatmentConversions, controlVisitors, treatmentVisitors } = data;

    if (controlVisitors < MIN_SAMPLE_SIZE || treatmentVisitors < MIN_SAMPLE_SIZE) {
      return {
        ...data,
        pValue: 1,
        isSignificant: false,
        confidenceLevel: 0
      };
    }

    const controlRate = controlConversions / controlVisitors;
    const treatmentRate = treatmentConversions / treatmentVisitors;

    const pooledRate = (controlConversions + treatmentConversions) / (controlVisitors + treatmentVisitors);
    const standardError = Math.sqrt(
      pooledRate * (1 - pooledRate) * (1/controlVisitors + 1/treatmentVisitors)
    );

    const zScore = standardError > 0 ? (treatmentRate - controlRate) / standardError : 0;
    const pValue = this.calculatePValue(zScore);
    const isSignificant = pValue < SIGNIFICANCE_THRESHOLD;
    const confidenceLevel = isSignificant ? (1 - pValue) * 100 : 0;

    return {
      ...data,
      pValue,
      isSignificant,
      confidenceLevel
    };
  }

  private calculatePValue(zScore: number): number {
    const absZ = Math.abs(zScore);
    return 2 * (1 - this.normalCDF(absZ));
  }

  private normalCDF(x: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - prob : prob;
  }

  /**
   * Cryptographically secure hash function using SHA-256
   * Returns a deterministic numeric value for consistent variant assignment
   */
  private async hashUserId(input: string): Promise<number> {
    try {
      // Use crypto.subtle for SHA-256 hash (available in modern browsers and Cloudflare Workers)
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const encoder = new TextEncoder();
        const data = encoder.encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);

        // Convert the first 8 bytes of the hash to a numeric value
        // This provides 64 bits of entropy, which is more than sufficient for variant assignment
        const hashArray = new Uint8Array(hashBuffer);
        let hash = 0;

        // Use the first 8 bytes to create a 53-bit integer (JavaScript's safe integer range)
        // This maintains deterministic behavior while being cryptographically secure
        for (let i = 0; i < 8; i++) {
          hash = hash * 256 + hashArray[i];
          // Keep within JavaScript's safe integer range
          if (hash > Number.MAX_SAFE_INTEGER / 256) {
            hash = hash % 1000000007; // Use a large prime for modulo to maintain distribution
          }
        }

        return Math.abs(hash);
      } else {
        // Fallback for environments without crypto.subtle
        // This should rarely be needed in modern browsers or Cloudflare Workers
        console.warn('[ABTesting] crypto.subtle not available, using fallback hash function');
        return this.fallbackHash(input);
      }
    } catch (error) {
      console.error('[ABTesting] Error computing SHA-256 hash, using fallback:', error);
      return this.fallbackHash(input);
    }
  }

  /**
   * Fallback hash function using FNV-1a algorithm
   * More secure than simple DJB2, but not cryptographically secure
   * Only used when crypto.subtle is unavailable
   */
  private fallbackHash(input: string): number {
    // FNV-1a hash algorithm - better distribution than DJB2
    let hash = 2166136261; // FNV offset basis for 32-bit
    const prime = 16777619; // FNV prime for 32-bit

    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, prime);
    }

    // Additional mixing for better distribution
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 2246822507);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 3266489909);
    hash ^= hash >>> 16;

    return Math.abs(hash);
  }

  getActiveExperiments(): string[] {
    return Array.from(this.assignments.keys());
  }

  resetExperiment(experimentId: string): void {
    this.assignments.delete(experimentId);
    this.persistAssignments();
  }

  resetAllExperiments(): void {
    this.assignments.clear();
    this.persistAssignments();
  }

  /**
   * Perform routine maintenance: cleanup old assignments and check quota
   */
  private performMaintenance(): void {
    try {
      const result = quotaManager.performMaintenance(STORAGE_KEY_AB_ASSIGNMENTS);

      if (result.cleanedItems > 0) {
        console.log(`[ABTesting] Cleaned up ${result.cleanedItems} old assignments`);
        // Reload assignments after cleanup
        this.loadPersistedAssignments();
      }

      if (!result.quotaAvailable) {
        console.warn('[ABTesting] localStorage quota is running low');
      }
    } catch (error) {
      console.error('[ABTesting] Error during maintenance:', error);
    }
  }

  /**
   * Emergency cleanup when quota is exceeded
   */
  private performEmergencyCleanup(): void {
    try {
      console.warn('[ABTesting] Performing emergency cleanup due to quota exceeded');

      // More aggressive cleanup: remove assignments older than 30 days
      const cleanedOld = quotaManager.cleanupOldItems(STORAGE_KEY_AB_ASSIGNMENTS, 30);
      console.log(`[ABTesting] Emergency cleanup removed ${cleanedOld} old assignments`);

      // Keep only the most recent 50 assignments for this user
      if (this.userId) {
        const assignments = Array.from(this.assignments.entries())
          .map(([id, assignment]) => ({ id, ...assignment }))
          .sort((a, b) => b.assignmentTime - a.assignmentTime)
          .slice(0, 50);

        this.assignments.clear();
        assignments.forEach(({ id, ...assignment }) => {
          this.assignments.set(id, assignment);
        });

        console.log(`[ABTesting] Reduced user assignments to ${this.assignments.size} most recent`);
      }
    } catch (error) {
      console.error('[ABTesting] Error during emergency cleanup:', error);
    }
  }

  /**
   * Get storage statistics for monitoring
   */
  getStorageStats(): {
    totalSize: number;
    itemCount: number;
    percentUsed: number;
    available: boolean;
    userAssignments: number;
  } {
    const stats = quotaManager.getStorageStats();
    return {
      ...stats,
      userAssignments: this.assignments.size
    };
  }
}

export const abTestingEngine = ABTestingEngine.getInstance();
