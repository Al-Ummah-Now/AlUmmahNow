// Community Posts Types - YouTube-style channel community tab

import { SoftDelete, Moderation } from './common';

export interface CommunityPost extends SoftDelete, Moderation {
  id: string;                        // UUID
  channelId: string;                 // Channel that created the post
  userId: string;                    // User ID of the post creator
  type: PostType;                    // text, image, poll, quiz, video, gif
  content?: string;                  // Text content (optional for image-only posts)

  // Media attachments
  images?: PostImage[];              // Up to 10 images
  videoId?: string;                  // For video link posts
  gif?: PostGif;                     // For GIF posts

  // Poll/Quiz specific
  poll?: PollData;                   // Poll configuration and options
  quiz?: QuizData;                   // Quiz configuration and questions

  // Engagement metrics
  likes: number;                      // Total likes count
  comments: number;                   // Total comments count (reference to comments system)
  shares: number;                     // Total shares count
  views: number;                      // Total views count

  // Metadata
  createdAt: string;                  // ISO timestamp
  updatedAt?: string;                 // ISO timestamp
  scheduledAt?: string;               // For scheduled posts
  expiresAt?: string;                 // For polls/quizzes
  pinned: boolean;                    // Pinned to top of feed

  // Moderation
  status: PostStatus;                 // published, scheduled, draft, deleted
  visibility: PostVisibility;         // public, subscribers, members
  commentsEnabled: boolean;           // Allow comments

  // Channel info (denormalized for performance)
  channelName: string;
  channelAvatar?: string;
  channelVerified: boolean;

  // Viewer state (computed per request when authenticated, never stored)
  viewerHasLiked?: boolean;
  viewerPollVote?: string[];          // Option IDs the viewer voted for
}

export interface PostImage {
  url: string;                       // CDN URL
  width: number;
  height: number;
  caption?: string;                   // For image polls (36 chars max)
  mimeType: string;                   // image/jpeg, image/png, etc.
  size: number;                       // File size in bytes
}

export interface PostGif {
  url: string;
  width: number;
  height: number;
  duration: number;                   // Animation duration in seconds
}

export interface PollData {
  question: string;
  options: PollOption[];              // 2-5 options
  totalVotes: number;
  multipleChoice: boolean;            // Allow multiple selections
  showResults: boolean;               // Show results before voting
  votingEndsAt?: string;              // ISO timestamp (up to 7 days)
}

export interface PollOption {
  id: string;                        // Option ID
  text?: string;                     // Text option (65 chars max)
  image?: PostImage;                 // Image option with caption
  votes: number;                     // Vote count
  percentage: number;                // Calculated percentage
}

export interface QuizData {
  question: string;
  options: QuizOption[];              // 2-4 options
  correctOptionId: string;
  explanation?: string;               // 500 chars max
  totalAttempts: number;
  correctAttempts: number;
}

export interface QuizOption {
  id: string;
  text: string;                      // 80 chars max (30 if image)
  image?: PostImage;
}

export enum PostType {
  TEXT = 'text',
  IMAGE = 'image',
  POLL = 'poll',
  QUIZ = 'quiz',
  VIDEO = 'video',
  GIF = 'gif'
}

export enum PostStatus {
  PUBLISHED = 'published',
  SCHEDULED = 'scheduled',
  DRAFT = 'draft',
  DELETED = 'deleted'
}

export enum PostVisibility {
  PUBLIC = 'public',
  SUBSCRIBERS = 'subscribers',
  MEMBERS = 'members'
}

// Vote tracking
export interface VoteRecord {
  userId: string;
  postId: string;
  optionIds: string[];                // Support for multiple choice
  votedAt: string;                    // ISO timestamp
  ipAddress?: string;                 // For anonymous vote tracking
}

export interface VoteResults {
  postId: string;
  totalVotes: number;
  options: {
    [optionId: string]: {
      count: number;
      percentage: number;
      voters?: string[];              // Only for non-anonymous polls
    }
  };
  lastUpdated: string;
}

// Request/Response types
export interface CreateCommunityPostRequest {
  type: PostType;
  content?: string;                   // Text content (max 5000 chars)
  images?: Omit<PostImage, 'url'>[];  // Images to upload
  videoId?: string;
  gif?: Omit<PostGif, 'url'>;
  poll?: {
    question: string;
    options: Array<{
      text?: string;                  // Max 65 chars
      image?: Omit<PostImage, 'url'>;
    }>;
    multipleChoice?: boolean;
    votingEndsAt?: string;
  };
  quiz?: {
    question: string;
    options: Array<{
      text: string;                    // Max 80 chars (30 with image)
      image?: Omit<PostImage, 'url'>;
    }>;
    correctOptionId: string;
    explanation?: string;              // Max 500 chars
  };
  visibility?: PostVisibility;
  commentsEnabled?: boolean;
  scheduledAt?: string;
}

export interface UpdateCommunityPostRequest {
  content?: string;
  visibility?: PostVisibility;
  commentsEnabled?: boolean;
  scheduledAt?: string;
  pinned?: boolean;
}

export interface ListCommunityPostsParams {
  channelId: string;
  page?: number;
  limit?: number;
  type?: PostType;
  status?: PostStatus;
}

export interface ListCommunityPostsResponse {
  posts: CommunityPost[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNext: boolean;
  };
}

export interface VoteOnPollRequest {
  optionIds: string[];
}

export interface VoteOnPollResponse {
  success: boolean;
  results: {
    totalVotes: number;
    options: Array<{
      id: string;
      votes: number;
      percentage: number;
    }>;
  };
}

export interface LikePostResponse {
  success: boolean;
  liked: boolean;
  totalLikes: number;
}

// Media upload types
export interface MediaUploadResponse {
  files: Array<{
    id: string;
    url: string;
    width: number;
    height: number;
    size: number;
    mimeType: string;
  }>;
}

// Analytics types
export interface PostAnalytics {
  postId: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number;             // (likes + comments + shares) / views
  pollParticipation?: number;         // votes / views
  topComments?: Array<{
    id: string;
    text: string;
    likes: number;
  }>;
}

// Notification types for processor
export interface CommunityPostNotification {
  type: 'community_post_created' | 'community_post_liked' | 'poll_ended';
  postId: string;
  channelId: string;
  userId?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}