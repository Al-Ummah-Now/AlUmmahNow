# AlUmmahNowProcessor
Queue Processor Service - Cloudflare Worker for processing AlUmmah queue messages

## Overview

This Cloudflare Worker is designed to consume and process messages from Cloudflare Queues. It supports multiple message types for video platform operations including profile management, channel operations, video interactions, comments, playlists, and subscriptions with built-in retry logic and dead letter queue handling.

## Features

- **Queue Message Processing**: Consumes messages from Cloudflare Queues with configurable batch processing
- **R2 Storage Integration**: Automatically saves all processed messages as JSON to Cloudflare R2 bucket
- **Multiple Message Types**: Supports profile, channel, video, comment, playlist, subscription, and watch history message types
- **Watch History Tracking**: Dedicated R2 buckets for production (`watch-history`) and preview/development (`watch-history-preview`)
- **Error Handling**: Comprehensive error handling with retry logic and dead letter queue support
- **Monitoring**: Built-in health checks and queue status endpoints
- **Environment Support**: Configurable for development, staging, and production environments
- **Type Safety**: Full TypeScript implementation with strict type checking
- **Logging**: Configurable logging with different log levels

## Project Structure

```
├── src/
│   ├── index.ts              # Main worker entry point
│   ├── types.ts              # TypeScript type definitions
│   ├── logger.ts             # Logging utility
│   └── messageProcessor.ts   # Message processing logic
├── wrangler.toml             # Cloudflare Worker configuration
├── package.json              # Dependencies and scripts
├── tsconfig.json            # TypeScript configuration
└── .eslintrc.js             # ESLint configuration
```

## Message Types

The worker supports processing various types of video platform messages:

### Profile Messages
- `ProfileCreate` - User profile creation
- `ProfileUpdate` - User profile updates
- `ProfileDelete` - User profile deletion
- `ProfileView` - Profile view tracking

### Channel Messages
- `ChannelCreate` - Channel creation
- `ChannelUpdate` - Channel updates
- `ChannelDelete` - Channel deletion
- `ChannelView` - Channel view tracking

### Subscription Messages
- `Subscribe` - User subscribes to a channel
- `Unsubscribe` - User unsubscribes from a channel

### Video Messages
- `VideoCreate` - Video upload/creation
- `VideoEdit` - Video editing
- `VideoDelete` - Video deletion
- `VideoView` - Video view tracking
- `VideoLike` - Video like action
- `VideoUnlike` - Video unlike action
- `VideoDislike` - Video dislike action
- `VideoUndislike` - Video undislike action

### Comment Messages
- `CommentCreate` - Comment creation
- `CommentEdit` - Comment editing
- `CommentDelete` - Comment deletion
- `CommentLike` - Comment like action
- `CommentDislike` - Comment dislike action
- `CommentUnlike` - Comment unlike action
- `CommentUndislike` - Comment undislike action

### Playlist Messages
- `PlaylistCreate` - Playlist creation
- `PlaylistEdit` - Playlist editing
- `PlaylistDelete` - Playlist deletion
- `PlaylistAdd` - Add video to playlist
- `PlaylistRemove` - Remove video from playlist
- `PlaylistClone` - Clone existing playlist

### Watch History Messages
- `WatchHistoryUpdate` - Update watch progress and history
- `WatchHistoryDelete` - Delete watch history entry

### Example Messages

#### Video View Message
```typescript
{
  id: "msg-123",
  type: MessageType.VideoView,
  timestamp: "2024-09-22T02:07:00Z",
  data: {
    videoId: "video-789",
    userId: "user-123"
  },
  priority: "normal"
}
```

#### Channel Subscription Message
```typescript
{
  id: "msg-456",
  type: MessageType.Subscribe,
  timestamp: "2024-09-22T02:07:00Z",
  data: {
    userId: "user-123",
    channelId: "channel-456"
  },
  priority: "normal"
}
```

#### Comment Creation Message
```typescript
{
  id: "msg-789",
  type: MessageType.CommentCreate,
  timestamp: "2024-09-22T02:07:00Z",
  data: {
    commentId: "comment-101",
    userId: "user-123",
    videoId: "video-789"
  },
  priority: "normal"
}
```

## Setup and Development

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Cloudflare account with Workers enabled
- Wrangler CLI installed

### Installation

1. Install dependencies:
```bash
npm install
```

2. Login to Cloudflare (if not already logged in):
```bash
npx wrangler login
```

3. Create the required resources in your Cloudflare dashboard:
   - **Queues**: `alummah-messages` (main queue), `alummah-dlq` (dead letter queue)
   - **R2 Buckets**:
     - `al-ummah-now-messages` (for message storage)
     - `watch-history` (production watch history)
     - `watch-history-preview` (preview/development watch history)

### Development

Run the worker locally:
```bash
npm run dev
```

This will start the worker in development mode with hot reloading.

### Testing

Type check the code:
```bash
npm run type-check
```

Lint the code:
```bash
npm run lint
```

Fix linting issues:
```bash
npm run lint:fix
```

Test the queue functionality by sending a test message (development only):
```bash
curl -X POST http://localhost:8787/queue/test
```

### Deployment

Deploy to staging:
```bash
npm run deploy:staging
```

Deploy to production:
```bash
npm run deploy
```

## Configuration

### Environment Variables

- `ENVIRONMENT`: Current environment (development, staging, production)
- `LOG_LEVEL`: Logging level (debug, info, warn, error)

### Queue and Storage Configuration

The worker is configured to:
- Process up to 10 messages per batch
- Wait up to 30 seconds before processing a partial batch
- Retry failed messages up to 3 times
- Send unprocessable messages to dead letter queue
- Automatically save all messages as JSON to R2 bucket `al-ummah-now-messages`

### Message Storage Structure

Messages are saved to R2 with the following key structure:
```
year-month-dayThour-min-sec.id
```

Examples:
- `2024-09-22T10-30-45.msg-123`
- `2024-09-22T15-45-30.msg-456`
- `2024-09-22T08-15-20.msg-789`

## API Endpoints

### Health Check
```
GET /health
```
Returns the worker health status.

### Queue Status
```
GET /queue/status
```
Returns the current queue processing status.

### Test Message (Development Only)
```
POST /queue/test
```
Sends a test message to the queue for testing purposes.

## Error Handling

The worker implements comprehensive error handling:

1. **Validation Errors**: Messages with invalid structure are not retried and sent directly to DLQ
2. **Processing Errors**: Temporary failures are retried up to 3 times
3. **Unexpected Errors**: Caught and logged with retry logic
4. **Dead Letter Queue**: Failed messages after max retries are sent to DLQ for manual review

## Monitoring and Observability

- Structured logging with configurable log levels
- Processing time tracking
- Batch processing statistics
- Health check endpoints for monitoring systems

## Contributing

1. Ensure TypeScript compiles without errors: `npm run type-check`
2. Ensure code passes linting: `npm run lint`
3. Test locally: `npm run dev`
4. Deploy to staging first: `npm run deploy:staging`

## License

MIT
