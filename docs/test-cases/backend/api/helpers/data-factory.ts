/**
 * Test Data Factory
 * Generates realistic test data for API testing
 */

// Basic types
export interface User {
  id?: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  username?: string;
  avatar?: string;
  bio?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Video {
  id?: string;
  title: string;
  description: string;
  tags: string[];
  visibility: 'public' | 'private' | 'unlisted';
  duration?: number;
  thumbnailUrl?: string;
  streamUrl?: string;
  channelId: string;
  userId: string;
  viewCount?: number;
  likeCount?: number;
  dislikeCount?: number;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
}

export interface Channel {
  id?: string;
  name: string;
  description: string;
  avatar?: string;
  banner?: string;
  userId: string;
  subscriberCount?: number;
  videoCount?: number;
  isVerified?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Playlist {
  id?: string;
  name: string;
  description?: string;
  userId: string;
  videoIds: string[];
  isPublic: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Comment {
  id?: string;
  content: string;
  userId: string;
  videoId: string;
  parentId?: string;
  likeCount?: number;
  dislikeCount?: number;
  isDeleted?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Subscription {
  id?: string;
  userId: string;
  channelId: string;
  createdAt?: string;
}

export interface WatchHistory {
  id?: string;
  userId: string;
  videoId: string;
  watchTime: number;
  duration: number;
  completed: boolean;
  lastPosition: number;
  createdAt?: string;
  updatedAt?: string;
}

// Utility functions for generating test data
const randomString = (length: number = 10): string => {
  return Math.random().toString(36).substring(2, 2 + length);
};

const randomEmail = (): string => {
  const domains = ['example.com', 'test.com', 'demo.org', 'sample.net'];
  const username = randomString(8);
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return `${username}@${domain}`;
};

const randomInt = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const randomBoolean = (probability: number = 0.5): boolean => {
  return Math.random() < probability;
};

const randomChoice = <T>(array: T[]): T => {
  return array[Math.floor(Math.random() * array.length)];
};

const randomDate = (past: boolean = true): string => {
  const now = new Date();
  const days = past ? -randomInt(1, 365) : randomInt(1, 365);
  const date = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));
  return date.toISOString();
};

const randomWords = (count: number): string => {
  const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua'];
  const selected = [];
  for (let i = 0; i < count; i++) {
    selected.push(randomChoice(words));
  }
  return selected.join(' ');
};

const randomSentence = (minWords: number = 3, maxWords: number = 10): string => {
  const wordCount = randomInt(minWords, maxWords);
  const sentence = randomWords(wordCount);
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
};

const randomParagraph = (sentences: number = 3): string => {
  const paragraph = [];
  for (let i = 0; i < sentences; i++) {
    paragraph.push(randomSentence());
  }
  return paragraph.join(' ');
};

/**
 * User Factory
 */
export class AuthFactory {
  static createUser(overrides: Partial<User> = {}): User {
    const firstName = randomChoice(['John', 'Jane', 'Mike', 'Sarah', 'David', 'Emily', 'Chris', 'Lisa', 'Tom', 'Anna']);
    const lastName = randomChoice(['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez']);
    const username = `${firstName.toLowerCase()}${lastName.toLowerCase()}${randomInt(1, 999)}`;
    
    return {
      email: randomEmail(),
      password: `TestPass${randomInt(100, 999)}!`,
      firstName,
      lastName,
      username,
      bio: randomParagraph(2),
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
      createdAt: randomDate(true),
      updatedAt: new Date().toISOString(),
      ...overrides
    };
  }

  static createAdminUser(overrides: Partial<User> = {}): User {
    return this.createUser({
      email: `admin${randomInt(1, 999)}@test.com`,
      username: `admin_${randomString(8)}`,
      ...overrides
    });
  }
}

/**
 * Video Factory
 */
export class VideoFactory {
  static create(overrides: Partial<Video> = {}): Video {
    const titles = [
      'Amazing Tutorial', 'How to Guide', 'Top 10 Tips', 'Best Practices',
      'Complete Guide', 'Step by Step', 'Quick Tips', 'Deep Dive',
      'Introduction to', 'Advanced Techniques', 'Getting Started', 'Master Class'
    ];
    
    const tagOptions = [
      'education', 'entertainment', 'music', 'gaming', 'news', 
      'sports', 'technology', 'cooking', 'travel', 'comedy',
      'tutorial', 'review', 'vlog', 'documentary', 'interview'
    ];
    
    return {
      id: `video_${randomString(20)}`,
      title: `${randomChoice(titles)} ${randomSentence(2, 5)}`,
      description: randomParagraph(3),
      tags: Array.from({ length: randomInt(1, 5) }, () => randomChoice(tagOptions)),
      visibility: randomChoice(['public', 'private', 'unlisted']),
      duration: randomInt(60, 7200), // 1 min to 2 hours
      thumbnailUrl: `https://picsum.photos/1280/720?random=${randomInt(1, 1000)}`,
      streamUrl: `https://example.com/stream/${randomString(20)}`,
      channelId: `channel_${randomString(20)}`,
      userId: `user_${randomString(20)}`,
      viewCount: randomInt(0, 1000000),
      likeCount: randomInt(0, 50000),
      dislikeCount: randomInt(0, 1000),
      createdAt: randomDate(true),
      updatedAt: new Date().toISOString(),
      publishedAt: randomDate(true),
      ...overrides
    };
  }

  static createPublic(overrides: Partial<Video> = {}): Video {
    return this.create({ visibility: 'public', ...overrides });
  }

  static createPrivate(overrides: Partial<Video> = {}): Video {
    return this.create({ visibility: 'private', ...overrides });
  }

  static createUnlisted(overrides: Partial<Video> = {}): Video {
    return this.create({ visibility: 'unlisted', ...overrides });
  }

  static createWithStats(overrides: Partial<Video> = {}): Video {
    return this.create({
      viewCount: randomInt(10000, 1000000),
      likeCount: randomInt(1000, 50000),
      dislikeCount: randomInt(10, 1000),
      ...overrides
    });
  }
}

/**
 * Channel Factory
 */
export class ChannelFactory {
  static create(overrides: Partial<Channel> = {}): Channel {
    const channelNames = [
      'Tech Reviews', 'Gaming Central', 'Cooking Show', 'Travel Vlog',
      'Music Channel', 'News Update', 'Sports Highlights', 'Education Hub',
      'Comedy Club', 'Documentary Channel', 'Art Gallery', 'Science Lab'
    ];
    
    return {
      id: `channel_${randomString(20)}`,
      name: `${randomChoice(channelNames)} ${randomInt(1, 999)}`,
      description: randomParagraph(2),
      avatar: `https://picsum.photos/200/200?random=${randomInt(1, 1000)}`,
      banner: `https://picsum.photos/1920/480?random=${randomInt(1, 1000)}`,
      userId: `user_${randomString(20)}`,
      subscriberCount: randomInt(0, 1000000),
      videoCount: randomInt(0, 1000),
      isVerified: randomBoolean(0.1), // 10% verified
      createdAt: randomDate(true),
      updatedAt: new Date().toISOString(),
      ...overrides
    };
  }

  static createVerified(overrides: Partial<Channel> = {}): Channel {
    return this.create({ isVerified: true, ...overrides });
  }

  static createPopular(overrides: Partial<Channel> = {}): Channel {
    return this.create({
      subscriberCount: randomInt(100000, 1000000),
      videoCount: randomInt(100, 1000),
      isVerified: true,
      ...overrides
    });
  }
}

/**
 * Playlist Factory
 */
export class PlaylistFactory {
  static create(overrides: Partial<Playlist> = {}): Playlist {
    const playlistNames = [
      'Favorites', 'Watch Later', 'Best Videos', 'Tutorial Collection',
      'Music Mix', 'Gaming Highlights', 'Travel Memories', 'Cooking Recipes',
      'Learning Path', 'Workout Playlist', 'Relaxing Videos', 'Funny Moments'
    ];
    
    return {
      id: `playlist_${randomString(20)}`,
      name: `${randomChoice(playlistNames)} ${randomInt(1, 999)}`,
      description: randomParagraph(1),
      userId: `user_${randomString(20)}`,
      videoIds: Array.from({ length: randomInt(1, 50) }, () => `video_${randomString(20)}`),
      isPublic: randomBoolean(0.7), // 70% public
      createdAt: randomDate(true),
      updatedAt: new Date().toISOString(),
      ...overrides
    };
  }

  static createPublic(overrides: Partial<Playlist> = {}): Playlist {
    return this.create({ isPublic: true, ...overrides });
  }

  static createPrivate(overrides: Partial<Playlist> = {}): Playlist {
    return this.create({ isPublic: false, ...overrides });
  }
}

/**
 * Comment Factory
 */
export class CommentFactory {
  static create(overrides: Partial<Comment> = {}): Comment {
    const comments = [
      'Great video! Thanks for sharing.',
      'This was really helpful, thank you!',
      'Amazing content, subscribed!',
      'Could you make more videos like this?',
      'First time watching, really enjoyed it.',
      'This changed my perspective on things.',
      'Perfect timing, I needed this!',
      'You explain things so clearly.',
      'This is exactly what I was looking for.',
      'Keep up the great work!'
    ];
    
    return {
      id: `comment_${randomString(20)}`,
      content: randomChoice(comments),
      userId: `user_${randomString(20)}`,
      videoId: `video_${randomString(20)}`,
      parentId: randomBoolean(0.2) ? `comment_${randomString(20)}` : undefined,
      likeCount: randomInt(0, 1000),
      dislikeCount: randomInt(0, 50),
      isDeleted: false,
      createdAt: randomDate(true),
      updatedAt: new Date().toISOString(),
      ...overrides
    };
  }

  static createReply(parentId: string, overrides: Partial<Comment> = {}): Comment {
    return this.create({ parentId, ...overrides });
  }

  static createDeleted(overrides: Partial<Comment> = {}): Comment {
    return this.create({ 
      isDeleted: true, 
      content: '[deleted]', 
      ...overrides 
    });
  }
}

/**
 * Subscription Factory
 */
export class SubscriptionFactory {
  static create(overrides: Partial<Subscription> = {}): Subscription {
    return {
      id: `subscription_${randomString(20)}`,
      userId: `user_${randomString(20)}`,
      channelId: `channel_${randomString(20)}`,
      createdAt: randomDate(true),
      ...overrides
    };
  }
}

/**
 * Watch History Factory
 */
export class WatchHistoryFactory {
  static create(overrides: Partial<WatchHistory> = {}): WatchHistory {
    const duration = randomInt(60, 7200);
    const watchTime = randomInt(0, duration);
    
    return {
      id: `history_${randomString(20)}`,
      userId: `user_${randomString(20)}`,
      videoId: `video_${randomString(20)}`,
      watchTime,
      duration,
      completed: watchTime >= duration * 0.9, // 90% watched = completed
      lastPosition: watchTime,
      createdAt: randomDate(true),
      updatedAt: new Date().toISOString(),
      ...overrides
    };
  }

  static createCompleted(overrides: Partial<WatchHistory> = {}): WatchHistory {
    const duration = randomInt(60, 7200);
    return this.create({
      duration,
      watchTime: duration,
      completed: true,
      lastPosition: duration,
      ...overrides
    });
  }

  static createPartial(overrides: Partial<WatchHistory> = {}): WatchHistory {
    const duration = randomInt(60, 7200);
    const watchTime = randomInt(1, Math.floor(duration * 0.8));
    return this.create({
      duration,
      watchTime,
      completed: false,
      lastPosition: watchTime,
      ...overrides
    });
  }
}

/**
 * Bulk Data Generators
 */
export class BulkDataFactory {
  static generateUsers(count: number): User[] {
    return Array.from({ length: count }, () => AuthFactory.createUser());
  }

  static generateVideos(count: number, overrides?: Partial<Video>): Video[] {
    return Array.from({ length: count }, () => VideoFactory.create(overrides || {}));
  }

  static generateChannels(count: number, overrides?: Partial<Channel>): Channel[] {
    return Array.from({ length: count }, () => ChannelFactory.create(overrides || {}));
  }

  static generateComments(count: number, videoId: string): Comment[] {
    return Array.from({ length: count }, () => 
      CommentFactory.create({ videoId })
    );
  }

  static generatePlaylists(count: number, userId: string): Playlist[] {
    return Array.from({ length: count }, () => 
      PlaylistFactory.create({ userId })
    );
  }
}

/**
 * Test Scenarios
 */
export class TestScenarioFactory {
  static createUserWithChannel(): { user: User; channel: Channel } {
    const user = AuthFactory.createUser();
    const channel = ChannelFactory.create({ userId: user.id! });
    return { user, channel };
  }

  static createChannelWithVideos(videoCount: number = 5): { channel: Channel; videos: Video[] } {
    const channel = ChannelFactory.create();
    const videos = Array.from({ length: videoCount }, () => 
      VideoFactory.create({ channelId: channel.id! })
    );
    return { channel, videos };
  }

  static createVideoWithComments(commentCount: number = 10): { video: Video; comments: Comment[] } {
    const video = VideoFactory.create();
    const comments = Array.from({ length: commentCount }, () => 
      CommentFactory.create({ videoId: video.id! })
    );
    return { video, comments };
  }

  static createUserWatchHistory(videoCount: number = 20): { user: User; history: WatchHistory[] } {
    const user = AuthFactory.createUser();
    const history = Array.from({ length: videoCount }, () => 
      WatchHistoryFactory.create({ userId: user.id! })
    );
    return { user, history };
  }
}

/**
 * Invalid Data for Testing Validation
 */
export class InvalidDataFactory {
  static invalidUser(): Partial<User>[] {
    return [
      { email: 'invalid-email', password: 'validPass123!' },
      { email: 'valid@example.com', password: '123' }, // too short
      { email: 'valid@example.com', password: 'password' }, // no numbers/special chars
      { email: '', password: 'validPass123!' }, // empty email
      { email: 'valid@example.com', password: '' }, // empty password
      { email: 'valid@example.com' }, // missing password
      { password: 'validPass123!' } // missing email
    ];
  }

  static invalidVideo(): Partial<Video>[] {
    return [
      { title: '', description: 'Valid description' }, // empty title
      { title: 'Valid title', description: '' }, // empty description
      { title: 'x'.repeat(300), description: 'Valid' }, // title too long
      { title: 'Valid', description: 'x'.repeat(5000) }, // description too long
      { title: 'Valid', visibility: 'invalid' as any }, // invalid visibility
      { title: 'Valid', tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6'] } // too many tags
    ];
  }

  static invalidChannel(): Partial<Channel>[] {
    return [
      { name: '', description: 'Valid description' }, // empty name
      { name: 'x'.repeat(200), description: 'Valid' }, // name too long
      { name: 'Valid', description: 'x'.repeat(2000) } // description too long
    ];
  }
}