/**
 * Analytics types
 */

export interface AnalyticsSummary {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalSubscribers: number;
  totalVideos: number;
  averageViewDuration?: number;
  watchTimeMinutes?: number;
}

export interface ChannelAnalytics extends AnalyticsSummary {
  channelId: string;
  period: AnalyticsPeriod;
  viewsHistory: MetricDataPoint[];
  subscribersHistory: MetricDataPoint[];
  topVideos: VideoAnalytics[];
  audienceDemographics?: AudienceDemographics;
  trafficSources?: TrafficSource[];
}

export interface VideoAnalytics {
  videoId: string;
  videoTitle: string;
  thumbnailUrl?: string;
  views: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  averageViewDuration?: number;
  watchTimeMinutes?: number;
  retentionRate?: number;
  period: AnalyticsPeriod;
  viewsHistory: MetricDataPoint[];
  trafficSources?: TrafficSource[];
}

export interface MetricDataPoint {
  date: string;
  value: number;
}

export interface AudienceDemographics {
  ageGroups?: AgeGroup[];
  genderDistribution?: GenderDistribution;
  topCountries?: CountryData[];
  topCities?: CityData[];
}

export interface AgeGroup {
  range: string;
  percentage: number;
}

export interface GenderDistribution {
  male: number;
  female: number;
  other: number;
}

export interface CountryData {
  country: string;
  countryCode: string;
  views: number;
  percentage: number;
}

export interface CityData {
  city: string;
  country: string;
  views: number;
  percentage: number;
}

export interface TrafficSource {
  source: string;
  views: number;
  percentage: number;
}

export type AnalyticsPeriod =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last28days'
  | 'last90days'
  | 'lifetime'
  | 'custom';

export interface AnalyticsParams {
  period?: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  metrics?: string[];
}

export interface MetricsParams extends AnalyticsParams {
  videoIds?: string[];
  channelId?: string;
}
