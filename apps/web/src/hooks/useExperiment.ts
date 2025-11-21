import { useEffect, useState, useCallback, useMemo } from 'react';
import { abTestingEngine, ExperimentResult } from '@/services/experiments/ab-testing';
import { getExperiment, isUserInTargetAudience, Experiment } from '@/services/experiments/feature-flags';
import { logger } from '@/lib/logger-client';


interface UseExperimentOptions {
  autoTrack?: boolean;
  enableConversionTracking?: boolean;
  userContext?: {
    deviceType?: string;
    userSegment?: string;
    sessionCount?: number;
  };
}

interface ExperimentState {
  isLoading: boolean;
  variant: 'control' | 'treatment' | null;
  experiment: Experiment | null;
  isInExperiment: boolean;
  error: string | null;
}

export function useExperiment(
  experimentId: string,
  userId: string | null,
  options: UseExperimentOptions = {}
): ExperimentState & {
  trackConversion: (value?: number) => void;
  reset: () => void;
  getVariantConfig: () => unknown;
} {
  const [state, setState] = useState<ExperimentState>({
    isLoading: true,
    variant: null,
    experiment: null,
    isInExperiment: false,
    error: null
  });

  const {
    enableConversionTracking = true,
    userContext = {}
  } = options;

  const experiment = useMemo(() => getExperiment(experimentId), [experimentId]);

  const initializeExperiment = useCallback(async () => {
    if (!userId) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'User not authenticated'
      }));
      return;
    }

    if (!experiment) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: `Experiment ${experimentId} not found`
      }));
      return;
    }

    if (!experiment.enabled) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        isInExperiment: false,
        error: null
      }));
      return;
    }

    if (!isUserInTargetAudience(experiment, userContext)) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        isInExperiment: false,
        error: null
      }));
      return;
    }

    try {
      abTestingEngine.initialize(userId);

      const existingVariant = abTestingEngine.getVariant(experimentId);
      let result: ExperimentResult;

      if (existingVariant) {
        result = {
          variant: existingVariant,
          assignmentTime: Date.now(),
          experimentId
        };
      } else {
        result = await abTestingEngine.assignVariant(experiment);
      }

      setState({
        isLoading: false,
        variant: result.variant,
        experiment,
        isInExperiment: true,
        error: null
      });

    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to assign variant'
      }));
    }
  }, [userId, experiment, experimentId, userContext]);

  const trackConversion = useCallback((value?: number) => {
    if (!enableConversionTracking || !state.isInExperiment) return;

    try {
      abTestingEngine.trackConversion(experimentId, value);
    } catch (error) {
      logger.error('Failed to track conversion:', error);
    }
  }, [enableConversionTracking, state.isInExperiment, experimentId]);

  const reset = useCallback(() => {
    abTestingEngine.resetExperiment(experimentId);
    setState({
      isLoading: true,
      variant: null,
      experiment: null,
      isInExperiment: false,
      error: null
    });
    setTimeout(initializeExperiment, 100);
  }, [experimentId, initializeExperiment]);

  const getVariantConfig = useCallback(() => {
    if (!state.variant || !experiment) return null;
    return experiment.variants[state.variant].config || null;
  }, [state.variant, experiment]);

  useEffect(() => {
    initializeExperiment();
  }, [initializeExperiment]);

  return {
    ...state,
    trackConversion,
    reset,
    getVariantConfig
  };
}

export function useExperiments(
  experimentIds: string[],
  userId: string | null,
  options: UseExperimentOptions = {}
) {
  const [experiments, setExperiments] = useState<Record<string, ExperimentState>>({});

  useEffect(() => {
    if (!userId) return;

    const results: Record<string, ExperimentState> = {};

    experimentIds.forEach(id => {
      const exp = getExperiment(id);
      if (exp) {
        try {
          abTestingEngine.initialize(userId);
          const variant = abTestingEngine.getVariant(id);

          results[id] = {
            isLoading: false,
            variant,
            experiment: exp,
            isInExperiment: variant !== null,
            error: null
          };
        } catch (error) {
          results[id] = {
            isLoading: false,
            variant: null,
            experiment: exp,
            isInExperiment: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }
    });

    setExperiments(results);
  }, [experimentIds, userId, options]);

  const trackConversion = useCallback((experimentId: string, value?: number) => {
    const state = experiments[experimentId];
    if (state?.isInExperiment) {
      abTestingEngine.trackConversion(experimentId, value);
    }
  }, [experiments]);

  const getActiveVariants = useCallback(() => {
    return Object.entries(experiments)
      .filter(([, state]) => state.isInExperiment)
      .reduce((acc, [id, state]) => {
        if (state.variant) {
          acc[id] = state.variant;
        }
        return acc;
      }, {} as Record<string, 'control' | 'treatment'>);
  }, [experiments]);

  return {
    experiments,
    trackConversion,
    getActiveVariants,
    isLoading: Object.values(experiments).some(state => state.isLoading)
  };
}
