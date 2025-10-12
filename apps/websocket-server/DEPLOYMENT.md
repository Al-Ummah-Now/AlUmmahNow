# WebSocket Server Deployment Guide

This guide covers deploying the WebSocket server to Cloudflare Workers.

## Prerequisites

1. Cloudflare account with Workers enabled
2. Wrangler CLI installed (`pnpm add -g wrangler`)
3. OpenAuth configured (same as api-videos)

## Steps

### 1. Configure KV Namespace

Create a KV namespace for presence tracking:

```bash
# Create production KV namespace
wrangler kv:namespace create "PRESENCE_KV"

# Create preview KV namespace
wrangler kv:namespace create "PRESENCE_KV" --preview
```

Note the namespace IDs returned and update `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  {
    "binding": "PRESENCE_KV",
    "id": "YOUR_PRODUCTION_KV_ID",
    "preview_id": "YOUR_PREVIEW_KV_ID"
  }
]
```

### 2. Configure Secrets

Set OpenAuth configuration (same as api-videos):

```bash
cd apps/websocket-server

# Set OpenAuth issuer
wrangler secret put Issuer
# Enter: https://auth.alummahnow.net

# Set OpenAuth audience
wrangler secret put Audience
# Enter: alummahnow

# Set OpenAuth client ID
wrangler secret put ClientId
# Enter: your-client-id
```

### 3. Deploy Durable Objects

The first deployment will create the Durable Object:

```bash
cd apps/websocket-server
pnpm deploy
```

Or from root:
```bash
pnpm websocket:deploy
```

### 4. Verify Deployment

Check the deployment:

```bash
# Health check
curl https://websocket-server.YOUR_SUBDOMAIN.workers.dev/health

# Stats
curl https://websocket-server.YOUR_SUBDOMAIN.workers.dev/stats
```

### 5. Configure Custom Domain (Optional)

Add a custom domain in Cloudflare Workers dashboard:

1. Go to Workers & Pages → websocket-server
2. Click "Settings" → "Domains & Routes"
3. Add custom domain: `realtime.alummahnow.net`

### 6. Update Environment Variables

Add WebSocket URL to other services:

**api-videos/wrangler.jsonc:**
```jsonc
"vars": {
  "WEBSOCKET_URL": "https://realtime.alummahnow.net"
}
```

**processor/wrangler.jsonc:**
```jsonc
"vars": {
  "WEBSOCKET_URL": "https://realtime.alummahnow.net"
}
```

### 7. Update Web App

Update the WebSocket URL in `apps/web/src/lib/websocket/WebSocketProvider.tsx`:

```typescript
const defaultConfig: WebSocketConfig = {
  url: process.env.NODE_ENV === 'production' 
    ? 'wss://realtime.alummahnow.net/ws' 
    : 'ws://localhost:8787/ws',
  // ...
};
```

## Monitoring

### View Logs

```bash
cd apps/websocket-server
wrangler tail
```

### Check Metrics

View metrics in Cloudflare Dashboard:
- Workers & Pages → websocket-server → Analytics
- Durable Objects → WebSocketDurableObject

### Check KV Usage

View KV metrics:
- Workers & Pages → KV → PRESENCE_KV → Metrics

## Troubleshooting

### Durable Object Migration Failed

If the initial deployment fails with a migration error:

1. Delete the Durable Object:
```bash
wrangler delete
```

2. Remove the migration from `wrangler.jsonc`:
```jsonc
"migrations": []
```

3. Deploy again:
```bash
pnpm deploy
```

4. Add the migration back:
```jsonc
"migrations": [
  {
    "tag": "v1",
    "new_classes": ["WebSocketDurableObject"]
  }
]
```

### WebSocket Connections Not Working

1. Check CORS settings in `src/index.ts`
2. Verify custom domain SSL certificate
3. Check browser console for WebSocket errors
4. Ensure WebSocket URL uses `wss://` for HTTPS

### Authentication Failing

1. Verify secrets are set:
```bash
wrangler secret list
```

2. Check OpenAuth issuer and audience match api-videos
3. Review JWT token format
4. Check Wrangler logs for auth errors

### KV Operations Slow

1. Check KV namespace is in the same region as Workers
2. Review TTL settings (default 5 minutes)
3. Consider caching presence data in Durable Object memory

## Rollback

To rollback to a previous version:

```bash
# List deployments
wrangler deployments list

# Rollback to specific deployment
wrangler rollback --deployment-id DEPLOYMENT_ID
```

## Scaling

### Horizontal Scaling

To handle more connections, shard by user ID:

```typescript
// In src/index.ts
app.get('/ws', async (c) => {
  const userId = c.req.query('userId');
  
  // Shard by user ID
  const shard = userId ? hashUserId(userId) % NUM_SHARDS : 0;
  const id = c.env.WEBSOCKET_DO.idFromName(`websocket-instance-${shard}`);
  
  const stub = c.env.WEBSOCKET_DO.get(id);
  return await stub.fetch(c.req.raw);
});
```

### Capacity Planning

Monitor these metrics:
- Active connections per instance (aim for < 1000)
- Message throughput (< 100/min per connection)
- KV operations per second
- CPU time per request

## Security

### Rate Limiting

Current rate limit: 100 messages/minute per connection

To adjust:
```typescript
// In src/websocket.ts
const maxMessages = 200; // Increase limit
const windowMs = 60000; // 1 minute
```

### Connection Limits

Consider adding connection limits per user:

```typescript
const MAX_CONNECTIONS_PER_USER = 5;

// In handleAuthentication
const userSessions = this.channelManager.getUserSessions(userId);
if (userSessions.length >= MAX_CONNECTIONS_PER_USER) {
  this.sendMessage(ws, {
    type: 'error',
    error: 'Too many connections',
    code: 'CONNECTION_LIMIT'
  });
  ws.close();
  return;
}
```

## Costs

Cloudflare Workers pricing:
- **Durable Objects**: $0.15/million requests
- **KV**: $0.50/million reads, $5/million writes
- **Workers**: Included in Workers Paid plan ($5/month)

Typical usage:
- 1000 concurrent connections
- 100 messages/minute per connection
- ~4.3M requests/month
- Estimated cost: ~$1-2/month

## Next Steps

1. Set up monitoring alerts in Cloudflare
2. Configure auto-scaling policies
3. Add metrics collection
4. Set up log aggregation
5. Plan for disaster recovery
