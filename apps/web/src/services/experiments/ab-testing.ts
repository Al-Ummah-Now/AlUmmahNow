import { Experiment, VariantConfig, ExperimentAssignment } from './feature-flags';
import { trackExperimentEvent } from './analytics';

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
  }

  private loadPersistedAssignments(): void {
    try {
      if (typeof window === 'undefined') return;

      const persisted = localStorage.getItem(STORAGE_KEY_AB_ASSIGNMENTS);
      if (persisted && this.userId) {
        const userAssignments = JSON.parse(persisted);
        if (userAssignments[this.userId]) {
          this.assignments = new Map(Object.entries(userAssignments[this.userId]));
        }
      }
    } catch (error) {
      console.warn('Failed to load persisted A/B test assignments:', error);
    }
  }

  private persistAssignments(): void {
    try {
      if (typeof window === 'undefined' || !this.userId) return;

      const persisted = localStorage.getItem(STORAGE_KEY_AB_ASSIGNMENTS) || '{}';
      const allAssignments = JSON.parse(persisted);
      allAssignments[this.userId] = Object.fromEntries(this.assignments);

      localStorage.setItem(STORAGE_KEY_AB_ASSIGNMENTS, JSON.stringify(allAssignments));
    } catch (error) {
      console.warn('Failed to persist A/B test assignments:', error);
    }
  }

  assignVariant(experiment: Experiment): ExperimentResult {
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

    const hash = this.hashUserId(this.userId + experiment.id);
    const isInExperiment = hash % 100 < experiment.trafficAllocation;

    if (!isInExperiment) {
      throw new Error(`User not in experiment ${experiment.id} traffic allocation`);
    }

    const variantHash = this.hashUserId(this.userId + experiment.id + 'variant');
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

  private hashUserId(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
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
}

export const abTestingEngine = ABTestingEngine.getInstance();
