/**
 * Common types used across the platform
 */

export interface PaginationParams {
  limit?: number;
  cursor?: string;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total?: number;
    limit: number;
    offset?: number;
    cursor?: string;
    nextCursor?: string;
    hasMore: boolean;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  message?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  statusCode?: number;
}

export interface Timestamps {
  createdAt: string;
  updatedAt?: string;
}

export interface SoftDelete {
  deletedAt?: string;
  isDeleted?: boolean;
}

export type Locale = 'en' | 'ar';

export type SortOrder = 'asc' | 'desc';

export interface SearchParams extends PaginationParams {
  query?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
  filters?: Record<string, unknown>;
}
