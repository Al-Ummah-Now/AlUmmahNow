# Testing Channel Upload Fix

## Issue
Getting "Missing required secret: image_storage_key" error when uploading channel avatar/cover.

## Root Cause
The `wrangler dev` process needs to be restarted to pick up the new helper functions and improved error logging.

## Steps to Test

### 1. Restart API Server
```bash
cd /home/meywd/AlUmmahNow/apps/api-videos

# Kill the current process
lsof -ti:3086 | xargs kill -9

# Start fresh with .dev.vars loaded
pnpm dev
```

### 2. Verify .dev.vars is Loaded
After starting, you should see in the console:
```
✨ Loaded .dev.vars
```

If you don't see this, the secrets won't be available.

### 3. Test Upload
Visit: `http://localhost:3000/en/channel/{channelId}/edit`

Upload a channel cover image.

### 4. Check API Console Logs
You should now see detailed logging:
```
[channelCoverUpdate] Environment check {
  hasImageStorageKey: true,
  imageStorageKeyType: 'string',
  hasZone: true,
  zoneValue: 'al-ummah-now-images'
}
```

### Expected Results

**If .dev.vars is loaded correctly:**
- `hasImageStorageKey`: true
- `imageStorageKeyType`: 'string'
- Upload succeeds with 200 response

**If .dev.vars is NOT loaded:**
- `hasImageStorageKey`: false
- Error: "Missing required secret: image_storage_key"

## Troubleshooting

### Problem: .dev.vars Not Loading

**Solution 1**: Verify file exists
```bash
ls -la /home/meywd/AlUmmahNow/apps/api-videos/.dev.vars
```

**Solution 2**: Check file contents (should have these lines)
```bash
cat /home/meywd/AlUmmahNow/apps/api-videos/.dev.vars | grep -E "(image_storage_key|ZONE)"
```

Expected output:
```
image_storage_key=2c4f445b-1f40-43cc-8d6a82c1cbe2-9c70-4489
```

**Solution 3**: Manually specify .dev.vars file
```bash
wrangler dev --var-file=.dev.vars --inspector-port=4086
```

### Problem: Still Getting 500 Error After Restart

Check the API console output for the new detailed error logs:
```
Error updating avatar photo: Error: Missing required secret: image_storage_key
Error details: {
  message: 'Missing required secret: image_storage_key',
  stack: '...'
}
```

This means `.dev.vars` is not being loaded. Try Solution 3 above.

### Problem: Different Error Message

If you see a different error in the API console, share it and we can debug further.

## Verification Checklist

- [ ] API server restarted successfully
- [ ] Console shows "✨ Loaded .dev.vars"
- [ ] Environment check logs show `hasImageStorageKey: true`
- [ ] Upload completes with 200 response
- [ ] Image appears in channel page
- [ ] Web app logs show success (check `/home/meywd/AlUmmahNow/logs/web.log`)

## Additional Debugging

If you want to see all environment variables being loaded:
```bash
cd /home/meywd/AlUmmahNow/apps/api-videos

# Add this temporary log at the top of handleCoverUpdate
console.log('Available env keys:', Object.keys(c.env));
```

This will show you what's actually available in `c.env`.
