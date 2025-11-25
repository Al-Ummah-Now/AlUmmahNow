/**
 * API Response Types
 * Additional response structures (ApiResponse is in common.ts)
 */

/**
 * Pagination metadata for list responses
 */
export interface PaginationMeta {
  limit: number;
  cursor?: string;
  hasMore: boolean;
  total?: number;
}

/**
 * Standard error response with code
 */
export interface ResponseError {
  success: false;
  error: string;
  message?: string;
  code?: string;
  statusCode?: number;
}

/**
 * List query parameters for paginated endpoints
 */
export interface ListQueryParams {
  limit?: number;
  cursor?: string;
  channelId?: string;
}

/**
 * API request headers
 */
export interface ApiHeaders {
  channelId?: string;
  userId?: string;
  authorization?: string;
}
