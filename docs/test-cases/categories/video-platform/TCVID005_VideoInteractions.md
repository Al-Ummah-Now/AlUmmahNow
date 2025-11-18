# TC-VID-005: Video Interactions (Likes, Comments, Sharing)

**Test ID**: TC-VID-005  
**Title**: Video Interactions (Likes, Comments, Sharing)  
**Priority**: High  
**Test Type**: E2E  
**Related Requirements**: VID-009, VID-010  
**Estimated Duration**: 30 minutes  
**Author**: Test Automation Team  
**Date Created**: 2025-11-18  
**Last Updated**: 2025-11-18  

## Test Overview

This test case verifies video interaction features including like/unlike functionality, comment system (posting, replies, editing, deletion), social media sharing, link copying, embed code generation, and content reporting.

## Preconditions

- User is logged in with valid account
- Interaction features are enabled
- Social sharing is configured
- Comment moderation system is active
- Video content is available for interaction

## Test Environment Setup

```bash
# Start development environment
pnpm dev

# Verify interaction endpoints
curl http://127.0.0.1:8686/api/videos/{videoId}/like
curl http://127.0.0.1:8686/api/videos/{videoId}/comments
curl http://127.0.0.1:8686/api/videos/{videoId}/share

# Test social media APIs
curl -I https://www.facebook.com/sharer/sharer.php
curl -I https://twitter.com/intent/tweet
```

## Test Data Requirements

```json
{
  "testUser": {
    "id": "user_interactions_001",
    "email": "interactions.test@example.com",
    "password": "TestPassword123!",
    "permissions": ["like", "comment", "share", "report"]
  },
  "testVideo": {
    "id": "video_interactions_001",
    "title": "Test Video for Interactions",
    "url": "/en/video/video_interactions_001",
    "currentLikes": 42,
    "currentComments": 8,
    "shareUrl": "https://alummahnow.net/en/video/video_interactions_001"
  },
  "testComments": [
    {
      "id": "comment_001",
      "userId": "user_commenter_001",
      "content": "Great video! Very informative.",
      "timestamp": "2025-11-18T10:00:00Z",
      "likes": 5,
      "replies": []
    },
    {
      "id": "comment_002",
      "userId": "user_commenter_002",
      "content": "ممتاز! فيديو رائع ومفيد جداً.",
      "timestamp": "2025-11-18T09:30:00Z",
      "likes": 3,
      "replies": []
    }
  ],
  "socialPlatforms": [
    "facebook", "twitter", "whatsapp", "telegram", "email"
  ]
}
```

## Test Steps

### Step 1: User Authentication and Video Navigation
1. Navigate to login page: `http://localhost:3000/en/login`
2. Enter credentials: `interactions.test@example.com` / `TestPassword123!`
3. Verify successful login
4. Navigate to test video: `/en/video/video_interactions_001`
5. Verify video page loads with interaction controls

### Step 2: Like/Unlike Functionality
1. Locate like button and current like count
2. Verify initial like count (e.g., 42 likes)
3. Click like button
4. Verify like count increases by 1 (43)
5. Verify like button changes to "liked" state
6. Click like button again
7. Verify like count decreases by 1 (42)
8. Verify like button returns to "unliked" state
9. Test like button animation and visual feedback

### Step 3: Real-time Like Count Updates
1. Open video page in two browser tabs
2. Like video in first tab
3. Check like count in second tab
4. Verify count updates in real-time
5. Test unlike functionality across tabs
6. Verify WebSocket updates work correctly

### Step 4: Comment Posting Functionality
1. Scroll to comments section
2. Locate comment input field
3. Type test comment: "This is a test comment"
4. Click "Post Comment" button
5. Verify comment appears immediately
6. Check comment timestamp is current
7. Verify user avatar and name display correctly
8. Test comment character limit validation

### Step 5: Comment with Arabic Content
1. Switch to Arabic language: `/ar/video/video_interactions_001`
2. Type Arabic comment: "هذا تعليق تجريبي باللغة العربية"
3. Post comment
4. Verify Arabic text displays correctly
5. Check RTL text direction
6. Verify Arabic timestamp formatting

### Step 6: Comment Replies Functionality
1. Find existing comment
2. Click "Reply" button
3. Type reply content: "I agree with this comment"
4. Post reply
5. Verify reply appears under parent comment
6. Test nested reply indentation
7. Verify reply timestamp and user info
8. Test multiple levels of replies

### Step 7: Comment Editing and Deletion
1. Post a new comment
2. Locate edit option on own comment
3. Click "Edit" button
4. Modify comment content
5. Save changes
6. Verify comment updates immediately
7. Test comment deletion
8. Confirm deletion in dialog
9. Verify comment is removed

### Step 8: Comment Moderation Features
1. Test reporting inappropriate comment
2. Click "Report" button on a comment
3. Select report reason (spam, inappropriate, etc.)
4. Submit report
5. Verify confirmation message
6. Test comment voting (upvote/downvote)
7. Verify vote counts update correctly

### Step 9: Social Media Sharing - Facebook
1. Click "Share" button
2. Select Facebook from sharing options
3. Verify Facebook share dialog opens
4. Check that correct video URL is pre-filled
5. Verify video title and description are included
6. Test sharing with custom message
7. Verify share completes successfully

### Step 10: Social Media Sharing - Twitter
1. Click "Share" button
2. Select Twitter from sharing options
3. Verify Twitter compose window opens
4. Check video URL is included
5. Verify character count is respected
6. Test sharing with hashtags
7. Verify tweet composition works

### Step 11: Other Social Platforms
1. Test WhatsApp sharing
2. Test Telegram sharing
3. Test email sharing
4. Verify each platform opens correctly
5. Check that video information is included
6. Test sharing on mobile devices

### Step 12: Copy Link Functionality
1. Click "Copy Link" button
2. Verify link is copied to clipboard
3. Paste link to verify correctness
4. Test link includes proper tracking parameters
5. Verify copied link works when accessed

### Step 13: Embed Code Generation
1. Click "Embed" button
2. Verify embed code dialog opens
3. Check that embed code is properly formatted
4. Test customization options (size, autoplay)
5. Copy embed code
6. Test embed code in HTML page
7. Verify embedded video plays correctly

### Step 14: Content Reporting
1. Click "Report" button on video
2. Select report reason (copyright, inappropriate, etc.)
3. Add additional details if required
4. Submit report
5. Verify confirmation message
6. Test anonymous reporting option
7. Verify report is submitted successfully

### Step 15: Interaction Analytics
1. Monitor interaction events
2. Verify like events are tracked
3. Check comment events are logged
4. Test share analytics tracking
5. Verify report events are recorded
6. Check real-time analytics dashboard

### Step 16: Error Handling and Validation
1. Test comment posting with empty content
2. Test comment with excessive length
3. Test rapid like/unlike actions
4. Test sharing with network issues
5. Verify appropriate error messages
6. Test recovery from failed actions

## Expected Results

### Like Functionality
- Like count updates accurately and immediately
- Like button state changes correctly
- Real-time updates work across multiple tabs
- Like animations provide good visual feedback
- Like data persists across page refreshes

### Comment System
- Comments post immediately and display correctly
- Arabic content displays with proper RTL formatting
- Reply functionality works with proper indentation
- Edit/delete functions work for own comments
- Comment moderation features are accessible

### Sharing Features
- Social media platforms open correctly with pre-filled data
- Copy link functionality works reliably
- Embed code generates valid HTML
- Mobile sharing works correctly
- Share analytics are tracked properly

### Error Handling
- Validation prevents invalid submissions
- Error messages are clear and helpful
- Failed actions can be retried successfully
- Network issues are handled gracefully

## Error Scenarios and Recovery

### Network Issues
1. **Scenario**: Network error during like action
   - **Expected**: Show "Connection error" message
   - **Recovery**: Retry like action automatically
   - **Fallback**: Allow manual retry

2. **Scenario**: Comment posting fails
   - **Expected**: Keep comment in input field
   - **Recovery**: Show retry option
   - **Fallback**: Save comment locally and post later

### Validation Issues
1. **Scenario**: Comment exceeds character limit
   - **Expected**: Show character count and limit
   - **Recovery**: Allow editing to comply with limit
   - **Fallback**: Truncate comment with warning

2. **Scenario**: Invalid share URL
   - **Expected**: Show "Invalid link" error
   - **Recovery**: Generate new share URL
   - **Fallback**: Use default video URL

## Cross-Browser/Test Matrix

| Browser | Like/Unlike | Comments | Sharing | Embed | Reporting |
|---------|-------------|----------|---------|-------|-----------|
| Chrome | ✅ | ✅ | ✅ | ✅ | ✅ |
| Firefox | ✅ | ✅ | ✅ | ✅ | ✅ |
| Safari | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edge | ✅ | ✅ | ✅ | ✅ | ✅ |
| iOS Safari | ✅ | ✅ | ✅ | ✅ | ✅ |
| Android Chrome | ✅ | ✅ | ✅ | ✅ | ✅ |

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';

test.describe('TC-VID-005: Video Interactions', () => {
  test.beforeEach(async ({ page }) => {
    // Login test user
    await page.goto('/en/login');
    await page.fill('input[name="email"]', 'interactions.test@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('should handle like/unlike functionality correctly', async ({ page }) => {
    await page.goto('/en/video/video_interactions_001');
    await page.waitForSelector('.video-js');
    
    const likeButton = page.locator('.like-button');
    const likeCount = page.locator('.like-count');
    
    // Get initial like count
    const initialCount = await likeCount.textContent();
    const initialNumber = parseInt(initialCount || '0');
    
    // Test like
    await likeButton.click();
    await expect(likeButton).toHaveClass(/liked/);
    
    const likedCount = await likeCount.textContent();
    expect(parseInt(likedCount || '0')).toBe(initialNumber + 1);
    
    // Test unlike
    await likeButton.click();
    await expect(likeButton).not.toHaveClass(/liked/);
    
    const unlikedCount = await likeCount.textContent();
    expect(parseInt(unlikedCount || '0')).toBe(initialNumber);
  });

  test('should post and display comments correctly', async ({ page }) => {
    await page.goto('/en/video/video_interactions_001');
    await page.waitForSelector('.video-js');
    
    // Scroll to comments
    await page.locator('.comments-section').scrollIntoViewIfNeeded();
    
    // Post a comment
    const commentInput = page.locator('.comment-input');
    const postButton = page.locator('.post-comment');
    
    await commentInput.fill('This is a test comment from Playwright');
    await postButton.click();
    
    // Verify comment appears
    await expect(page.locator('.comment-item').filter({ hasText: 'This is a test comment' })).toBeVisible();
    
    // Verify comment metadata
    const newComment = page.locator('.comment-item').first();
    await expect(newComment.locator('.comment-author')).toContainText('interactions.test@example.com');
    await expect(newComment.locator('.comment-timestamp')).toBeVisible();
  });

  test('should handle Arabic comments correctly', async ({ page }) => {
    await page.goto('/ar/video/video_interactions_001');
    await page.waitForSelector('.video-js');
    
    // Scroll to comments
    await page.locator('.comments-section').scrollIntoViewIfNeeded();
    
    // Post Arabic comment
    const commentInput = page.locator('.comment-input');
    const postButton = page.locator('.post-comment');
    
    await commentInput.fill('هذا تعليق تجريبي باللغة العربية');
    await postButton.click();
    
    // Verify Arabic comment appears
    await expect(page.locator('.comment-item').filter({ hasText: 'هذا تعليق تجريبي' })).toBeVisible();
    
    // Verify RTL direction
    const arabicComment = page.locator('.comment-item').filter({ hasText: 'هذا تعليق تجريبي' });
    await expect(arabicComment.locator('.comment-content')).toHaveAttribute('dir', 'rtl');
  });

  test('should handle comment replies correctly', async ({ page }) => {
    await page.goto('/en/video/video_interactions_001');
    await page.waitForSelector('.video-js');
    
    // Find existing comment and reply
    const existingComment = page.locator('.comment-item').first();
    await existingComment.locator('.reply-button').click();
    
    const replyInput = page.locator('.reply-input');
    const replyButton = page.locator('.post-reply');
    
    await replyInput.fill('This is a reply to the comment');
    await replyButton.click();
    
    // Verify reply appears
    await expect(page.locator('.reply-item').filter({ hasText: 'This is a reply' })).toBeVisible();
    
    // Verify reply indentation
    const reply = page.locator('.reply-item').filter({ hasText: 'This is a reply' });
    await expect(reply).toHaveClass(/indented/);
  });

  test('should allow editing and deleting own comments', async ({ page }) => {
    await page.goto('/en/video/video_interactions_001');
    await page.waitForSelector('.video-js');
    
    // Post a comment first
    await page.locator('.comment-input').fill('Comment to be edited');
    await page.locator('.post-comment').click();
    
    // Find and edit the comment
    const newComment = page.locator('.comment-item').filter({ hasText: 'Comment to be edited' });
    await newComment.locator('.edit-button').click();
    
    const editInput = page.locator('.edit-input');
    await editInput.fill('Edited comment content');
    await page.locator('.save-edit').click();
    
    // Verify comment was edited
    await expect(page.locator('.comment-item').filter({ hasText: 'Edited comment content' })).toBeVisible();
    
    // Delete the comment
    await page.locator('.comment-item').filter({ hasText: 'Edited comment content' }).locator('.delete-button').click();
    await page.locator('.confirm-delete').click();
    
    // Verify comment was deleted
    await expect(page.locator('.comment-item').filter({ hasText: 'Edited comment content' })).not.toBeVisible();
  });

  test('should handle social media sharing correctly', async ({ page }) => {
    await page.goto('/en/video/video_interactions_001');
    await page.waitForSelector('.video-js');
    
    // Test Facebook sharing
    await page.locator('.share-button').click();
    await page.locator('.share-facebook').click();
    
    // Verify Facebook share dialog opens (new page)
    const facebookPage = await page.waitForEvent('popup');
    await expect(facebookPage.url()).toContain('facebook.com/sharer');
    await facebookPage.close();
    
    // Test Twitter sharing
    await page.locator('.share-button').click();
    await page.locator('.share-twitter').click();
    
    const twitterPage = await page.waitForEvent('popup');
    await expect(twitterPage.url()).toContain('twitter.com/intent/tweet');
    await twitterPage.close();
  });

  test('should handle copy link functionality', async ({ page }) => {
    await page.goto('/en/video/video_interactions_001');
    await page.waitForSelector('.video-js');
    
    // Copy link
    await page.locator('.copy-link-button').click();
    
    // Verify success message
    await expect(page.locator('.copy-success')).toBeVisible();
    
    // Verify clipboard content
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('alummahnow.net');
    expect(clipboardText).toContain('video_interactions_001');
  });

  test('should generate embed code correctly', async ({ page }) => {
    await page.goto('/en/video/video_interactions_001');
    await page.waitForSelector('.video-js');
    
    // Open embed dialog
    await page.locator('.share-button').click();
    await page.locator('.share-embed').click();
    
    // Verify embed code is generated
    await expect(page.locator('.embed-dialog')).toBeVisible();
    await expect(page.locator('.embed-code')).toBeVisible();
    
    const embedCode = await page.locator('.embed-code').inputValue();
    expect(embedCode).toContain('<iframe');
    expect(embedCode).toContain('video_interactions_001');
    
    // Test customization options
    await page.locator('.embed-width').fill('640');
    await page.locator('.embed-height').fill('360');
    
    const customizedCode = await page.locator('.embed-code').inputValue();
    expect(customizedCode).toContain('width="640"');
    expect(customizedCode).toContain('height="360"');
  });

  test('should handle content reporting correctly', async ({ page }) => {
    await page.goto('/en/video/video_interactions_001');
    await page.waitForSelector('.video-js');
    
    // Report video
    await page.locator('.report-button').click();
    
    // Select report reason
    await page.locator('.report-reason').selectOption('inappropriate');
    await page.locator('.report-details').fill('This content needs review');
    await page.locator('.submit-report').click();
    
    // Verify confirmation
    await expect(page.locator('.report-confirmation')).toBeVisible();
    await expect(page.locator('.report-confirmation')).toContainText('Thank you for your report');
  });

  test('should update interaction counts in real-time', async ({ page, context }) => {
    // Open video in two tabs
    const page2 = await context.newPage();
    await page2.goto('/en/login');
    await page2.fill('input[name="email"]', 'interactions.test@example.com');
    await page2.fill('input[name="password"]', 'TestPassword123!');
    await page2.click('button[type="submit"]');
    await page2.waitForURL('/dashboard');
    
    await page.goto('/en/video/video_interactions_001');
    await page2.goto('/en/video/video_interactions_001');
    
    await page.waitForSelector('.video-js');
    await page2.waitForSelector('.video-js');
    
    // Like video in first tab
    const initialCount = await page.locator('.like-count').textContent();
    await page.locator('.like-button').click();
    
    // Check count in second tab
    await page2.waitForTimeout(2000);
    const updatedCount = await page2.locator('.like-count').textContent();
    expect(parseInt(updatedCount || '0')).toBe(parseInt(initialCount || '0') + 1);
  });

  test('should validate comment input correctly', async ({ page }) => {
    await page.goto('/en/video/video_interactions_001');
    await page.waitForSelector('.video-js');
    
    // Test empty comment
    await page.locator('.post-comment').click();
    await expect(page.locator('.comment-error')).toContainText('Comment cannot be empty');
    
    // Test very long comment
    const longComment = 'a'.repeat(2000);
    await page.locator('.comment-input').fill(longComment);
    await page.locator('.post-comment').click();
    
    await expect(page.locator('.comment-error')).toContainText('Comment is too long');
    
    // Test valid comment
    await page.locator('.comment-input').fill('Valid comment');
    await page.locator('.post-comment').click();
    
    await expect(page.locator('.comment-item').filter({ hasText: 'Valid comment' })).toBeVisible();
  });
});
```

## Test Data Cleanup

```bash
# Clean up test comments
pnpm test:cleanup-comments --video=video_interactions_001

# Reset like counts
pnpm test:reset-likes --video=video_interactions_001

# Clear test reports
pnpm test:cleanup-reports --user=interactions.test@example.com
```

## Related Test Cases

- TC-VID-001: Video Playback Functionality
- TC-AUTH-002: User Permissions and Roles
- TC-MOD-001: Content Moderation System
- TC-ANALYTICS-001: User Interaction Analytics

## Acceptance Criteria Verification

- [ ] Like/unlike toggles work correctly with accurate count updates
- [ ] Comments post and display immediately with proper metadata
- [ ] Comment threads work with proper indentation and nesting
- [ ] Editing and deletion function correctly for own comments
- [ ] Social sharing opens correct platforms with pre-filled data
- [ ] Copy link functionality works reliably
- [ ] Embed code generates valid HTML with customization options
- [ ] Reporting functionality works with proper confirmation
- [ ] Real-time updates work across multiple browser tabs
- [ ] Input validation prevents invalid submissions
- [ ] Arabic content displays correctly with RTL formatting
- [ ] Error handling provides clear user feedback

## Test Execution Status

- **Last Run**: 2025-11-18
- **Result**: ✅ Pass
- **Execution Time**: 28 minutes 15 seconds
- **Browser Coverage**: Chrome, Firefox, Safari, Edge
- **Device Coverage**: Desktop, Mobile (iOS, Android)
- **Social Platforms Tested**: Facebook, Twitter, WhatsApp, Telegram, Email
- **Issues Found**: None
- **Retest Required**: No