export interface VariantConfig {
  id: string;
  name: string;
  description: string;
  config?: Record<string, unknown>;
}

export interface ExperimentAssignment {
  variant: 'control' | 'treatment';
  assignmentTime: number;
  experimentId: string;
}

export interface Experiment {
  id: string;
  name: string;
  description: string;
  variants: {
    control: VariantConfig;
    treatment: VariantConfig;
  };
  trafficAllocation: number;
  enabled: boolean;
  startDate?: number;
  endDate?: number;
  targetAudience?: {
    deviceTypes?: string[];
    userSegments?: string[];
    minSessionCount?: number;
  };
}

export const EXPERIMENTS: Record<string, Experiment> = {
  'video-player-ui': {
    id: 'video-player-ui',
    name: 'Video Player UI Redesign',
    description: 'Test new video player interface with enhanced controls',
    variants: {
      control: {
        id: 'control',
        name: 'Current Player',
        description: 'Existing video player interface'
      },
      treatment: {
        id: 'treatment',
        name: 'Enhanced Player',
        description: 'New player with gesture controls and mini-player',
        config: {
          enableGestures: true,
          enableMiniPlayer: true,
          showQualityIndicator: true,
          autoplayBehavior: 'smart'
        }
      }
    },
    trafficAllocation: 50,
    enabled: true,
    startDate: Date.now(),
    endDate: Date.now() + (30 * 24 * 60 * 60 * 1000)
  },

  'video-quality-selection': {
    id: 'video-quality-selection',
    name: 'Auto Quality Selection Algorithm',
    description: 'Test improved adaptive bitrate streaming',
    variants: {
      control: {
        id: 'control',
        name: 'Current Algorithm',
        description: 'Existing quality selection logic'
      },
      treatment: {
        id: 'treatment',
        name: 'ML-Enhanced Algorithm',
        description: 'Machine learning based quality selection',
        config: {
          enableMLPrediction: true,
          bufferTarget: 10,
          qualityStepSize: 1,
          networkHistoryWindow: 30
        }
      }
    },
    trafficAllocation: 25,
    enabled: true
  },

  'video-recommendations': {
    id: 'video-recommendations',
    name: 'Personalized Recommendations',
    description: 'Test new recommendation engine',
    variants: {
      control: {
        id: 'control',
        name: 'Current Recommendations',
        description: 'Existing recommendation algorithm'
      },
      treatment: {
        id: 'treatment',
        name: 'AI-Powered Recommendations',
        description: 'Enhanced recommendations with user behavior analysis',
        config: {
          enableCollaborativeFiltering: true,
          includeWatchTime: true,
          recommendationCount: 8,
          diversityWeight: 0.3
        }
      }
    },
    trafficAllocation: 75,
    enabled: false
  },

  'video-loading-optimization': {
    id: 'video-loading-optimization',
    name: 'Video Loading Optimization',
    description: 'Test preloading strategies for faster video start',
    variants: {
      control: {
        id: 'control',
        name: 'Standard Loading',
        description: 'Current video loading behavior'
      },
      treatment: {
        id: 'treatment',
        name: 'Predictive Preloading',
        description: 'Smart preloading based on user behavior',
        config: {
          preloadThreshold: 0.7,
          maxPreloadVideos: 2,
          enableNetworkAwarePreloading: true
        }
      }
    },
    trafficAllocation: 100,
    enabled: true,
    targetAudience: {
      deviceTypes: ['desktop', 'mobile'],
      minSessionCount: 3
    }
  }
};

export function getExperiment(experimentId: string): Experiment | null {
  return EXPERIMENTS[experimentId] || null;
}

export function getActiveExperiments(): Experiment[] {
  const now = Date.now();
  return Object.values(EXPERIMENTS).filter(exp => {
    if (!exp.enabled) return false;
    if (exp.startDate && now < exp.startDate) return false;
    if (exp.endDate && now > exp.endDate) return false;
    return true;
  });
}

export function isUserInTargetAudience(
  experiment: Experiment,
  userContext: {
    deviceType?: string;
    userSegment?: string;
    sessionCount?: number;
  }
): boolean {
  if (!experiment.targetAudience) return true;

  const { deviceTypes, userSegments, minSessionCount } = experiment.targetAudience;

  if (deviceTypes && userContext.deviceType && !deviceTypes.includes(userContext.deviceType)) {
    return false;
  }

  if (userSegments && userContext.userSegment && !userSegments.includes(userContext.userSegment)) {
    return false;
  }

  if (minSessionCount && userContext.sessionCount && userContext.sessionCount < minSessionCount) {
    return false;
  }

  return true;
}
