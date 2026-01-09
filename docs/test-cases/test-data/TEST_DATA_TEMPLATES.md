# Test Data Templates

## Overview

This document provides standardized test data templates for use across all test categories in the Al Ummah Now platform testing suite.

## User Account Templates

### Standard User Account
```json
{
  "id": "user_standard_001",
  "email": "test.user@example.com",
  "username": "testuser",
  "password": "TestPassword123!",
  "firstName": "Test",
  "lastName": "User",
  "language": "en",
  "role": "user",
  "permissions": ["view_content", "comment", "like"],
  "profile": {
    "avatar": "https://example.com/avatars/default.png",
    "bio": "Test user account for automated testing",
    "location": "Test City",
    "joinDate": "2024-01-01T00:00:00Z"
  }
}
```

### Arabic User Account
```json
{
  "id": "user_arabic_001",
  "email": "مستخدم.اختبار@example.com",
  "username": "مستخدم_اختبار",
  "password": "TestPassword123!",
  "firstName": "مستخدم",
  "lastName": "اختبار",
  "language": "ar",
  "role": "user",
  "permissions": ["view_content", "comment", "like"],
  "profile": {
    "avatar": "https://example.com/avatars/arabic-default.png",
    "bio": "حساب مستخدم للاختبار الآلي",
    "location": "مدينة الاختبار",
    "joinDate": "2024-01-01T00:00:00Z"
  }
}
```

### Admin User Account
```json
{
  "id": "user_admin_001",
  "email": "admin@example.com",
  "username": "admin",
  "password": "AdminPassword123!",
  "firstName": "Admin",
  "lastName": "User",
  "language": "en",
  "role": "admin",
  "permissions": ["view_content", "comment", "like", "moderate", "manage_users", "manage_content"],
  "profile": {
    "avatar": "https://example.com/avatars/admin.png",
    "bio": "Administrator account for testing",
    "location": "Admin City",
    "joinDate": "2024-01-01T00:00:00Z"
  }
}
```

## Video Content Templates

### Standard Video
```json
{
  "id": "video_standard_001",
  "title": {
    "en": "Test Video Title",
    "ar": "عنوان الفيديو التجريبي"
  },
  "description": {
    "en": "This is a test video for automated testing purposes",
    "ar": "هذا فيديو تجريبي لأغراض الاختبار الآلي"
  },
  "duration": 300,
  "url": "https://cdn.example.com/videos/test-video.mp4",
  "thumbnail": "https://cdn.example.com/thumbnails/test-video.jpg",
  "channelId": "channel_test_001",
  "categoryId": "education",
  "tags": ["test", "automation", "quality"],
  "language": "en",
  "quality": ["360p", "480p", "720p", "1080p"],
  "subtitles": {
    "en": "https://cdn.example.com/subtitles/test-video-en.vtt",
    "ar": "https://cdn.example.com/subtitles/test-video-ar.vtt"
  },
  "metadata": {
    "uploadDate": "2024-01-01T00:00:00Z",
    "viewCount": 1000,
    "likeCount": 50,
    "commentCount": 10,
    "fileSize": 52428800,
    "format": "mp4"
  }
}
```

### Long Form Video
```json
{
  "id": "video_long_001",
  "title": {
    "en": "Long Form Test Video",
    "ar": "فيديو تجريبي طويل"
  },
  "description": {
    "en": "This is a long form test video for testing progress tracking and resume functionality",
    "ar": "هذا فيديو تجريبي طويل لاختبار تتبع التقدم واستئناف التشغيل"
  },
  "duration": 3600,
  "url": "https://cdn.example.com/videos/long-test-video.mp4",
  "thumbnail": "https://cdn.example.com/thumbnails/long-test-video.jpg",
  "channelId": "channel_test_001",
  "categoryId": "education",
  "tags": ["test", "long-form", "progress"],
  "language": "en",
  "quality": ["360p", "480p", "720p", "1080p"],
  "subtitles": {
    "en": "https://cdn.example.com/subtitles/long-test-video-en.vtt",
    "ar": "https://cdn.example.com/subtitles/long-test-video-ar.vtt"
  },
  "metadata": {
    "uploadDate": "2024-01-01T00:00:00Z",
    "viewCount": 500,
    "likeCount": 25,
    "commentCount": 5,
    "fileSize": 1073741824,
    "format": "mp4"
  }
}
```

## Channel Templates

### Standard Channel
```json
{
  "id": "channel_standard_001",
  "name": {
    "en": "Test Channel",
    "ar": "قناة الاختبار"
  },
  "description": {
    "en": "This is a test channel for automated testing",
    "ar": "هذه قناة اختبار للاختبار الآلي"
  },
  "url": "test-channel",
  "ownerId": "user_standard_001",
  "categoryId": "education",
  "visibility": "public",
  "branding": {
    "banner": "https://cdn.example.com/banners/test-channel.jpg",
    "avatar": "https://cdn.example.com/avatars/test-channel.png",
    "colorScheme": {
      "primary": "#007bff",
      "secondary": "#6c757d"
    }
  },
  "settings": {
    "allowComments": true,
    "allowSubscriptions": true,
    "moderationLevel": "standard"
  },
  "metadata": {
    "createdDate": "2024-01-01T00:00:00Z",
    "subscriberCount": 100,
    "videoCount": 25,
    "totalViews": 10000
  }
}
```

## Comment Templates

### Standard Comment
```json
{
  "id": "comment_standard_001",
  "videoId": "video_standard_001",
  "userId": "user_standard_001",
  "content": {
    "en": "This is a test comment",
    "ar": "هذا تعليق تجريبي"
  },
  "timestamp": "2024-01-01T12:00:00Z",
  "likeCount": 5,
  "replyCount": 2,
  "status": "approved",
  "language": "en"
}
```

### Comment Thread
```json
{
  "id": "comment_thread_001",
  "videoId": "video_standard_001",
  "userId": "user_standard_001",
  "content": {
    "en": "This is a parent comment with replies",
    "ar": "هذا تعليق رئيسي مع ردود"
  },
  "timestamp": "2024-01-01T12:00:00Z",
  "likeCount": 10,
  "replyCount": 3,
  "status": "approved",
  "language": "en",
  "replies": [
    {
      "id": "comment_reply_001",
      "parentId": "comment_thread_001",
      "userId": "user_arabic_001",
      "content": {
        "en": "This is a reply to the parent comment",
        "ar": "هذا رد على التعليق الرئيسي"
      },
      "timestamp": "2024-01-01T12:05:00Z",
      "likeCount": 2,
      "status": "approved",
      "language": "ar"
    }
  ]
}
```

## Search Test Data

### Search Terms - English
```json
{
  "simple": ["test", "video", "channel", "education"],
  "phrase": ["test video", "educational content", "islamic content"],
  "special": ["test-video", "video_test", "content@education"],
  "numbers": ["video 1", "test 2024", "channel 123"],
  "mixed": ["test video 2024", "educational content islamic"]
}
```

### Search Terms - Arabic
```json
{
  "simple": ["اختبار", "فيديو", "قناة", "تعليم"],
  "phrase": ["فيديو اختبار", "محتوى تعليمي", "محتوى إسلامي"],
  "special": ["فيديو-اختبار", "اختبار_فيديو", "محتوى@تعليم"],
  "numbers": ["فيديو ١", "اختبار ٢٠٢٤", "قناة ١٢٣"],
  "mixed": ["فيديو اختبار ٢٠٢٤", "محتوى تعليمي إسلامي"]
}
```

## Form Test Data

### Registration Form Data
```json
{
  "valid": {
    "email": "newuser@example.com",
    "username": "newuser",
    "password": "NewPassword123!",
    "confirmPassword": "NewPassword123!",
    "firstName": "New",
    "lastName": "User",
    "language": "en",
    "termsAccepted": true
  },
  "invalid": {
    "email": "invalid-email",
    "username": "ab",
    "password": "123",
    "confirmPassword": "different",
    "firstName": "",
    "lastName": "",
    "language": "invalid",
    "termsAccepted": false
  }
}
```

### Login Form Data
```json
{
  "valid": {
    "email": "test.user@example.com",
    "password": "TestPassword123!"
  },
  "invalid": {
    "email": "wrong@example.com",
    "password": "WrongPassword123!"
  },
  "empty": {
    "email": "",
    "password": ""
  }
}
```

## Performance Test Data

### Network Conditions
```json
{
  "fast": {
    "download": "10 Mbps",
    "upload": "5 Mbps",
    "latency": "50ms",
    "packetLoss": "0%"
  },
  "average": {
    "download": "3 Mbps",
    "upload": "1 Mbps",
    "latency": "200ms",
    "packetLoss": "1%"
  },
  "slow": {
    "download": "0.5 Mbps",
    "upload": "0.3 Mbps",
    "latency": "500ms",
    "packetLoss": "3%"
  }
}
```

### Device Specifications
```json
{
  "high_end": {
    "cpu": "8 cores",
    "memory": "8GB",
    "storage": "256GB",
    "gpu": "dedicated"
  },
  "mid_range": {
    "cpu": "4 cores",
    "memory": "4GB",
    "storage": "64GB",
    "gpu": "integrated"
  },
  "low_end": {
    "cpu": "2 cores",
    "memory": "2GB",
    "storage": "16GB",
    "gpu": "integrated"
  }
}
```

## Error Test Data

### API Error Responses
```json
{
  "authentication": {
    "status": 401,
    "message": "Authentication failed",
    "code": "AUTH_001"
  },
  "authorization": {
    "status": 403,
    "message": "Access denied",
    "code": "AUTH_002"
  },
  "notFound": {
    "status": 404,
    "message": "Resource not found",
    "code": "RESOURCE_001"
  },
  "validation": {
    "status": 400,
    "message": "Validation failed",
    "code": "VALIDATION_001",
    "details": {
      "field": "email",
      "error": "Invalid email format"
    }
  },
  "serverError": {
    "status": 500,
    "message": "Internal server error",
    "code": "SERVER_001"
  }
}
```

## Accessibility Test Data

### WCAG Test Scenarios
```json
{
  "keyboardNavigation": {
    "elements": ["button", "link", "input", "select", "textarea"],
    "actions": ["tab", "shift+tab", "enter", "space", "escape", "arrows"]
  },
  "screenReader": {
    "elements": ["heading", "link", "button", "form", "table", "list"],
    "attributes": ["aria-label", "aria-describedby", "role", "alt"]
  },
  "colorContrast": {
    "ratios": {
      "normalText": "4.5:1",
      "largeText": "3:1",
      "interactive": "3:1"
    }
  }
}
```

## Usage Guidelines

### Data Management
1. Use consistent IDs across test scenarios
2. Maintain data relationships (users → channels → videos)
3. Clean up test data after test execution
4. Use environment-specific data prefixes

### Data Generation
1. Use deterministic data for reproducible tests
2. Generate unique data for concurrency tests
3. Use realistic data for performance tests
4. Include edge cases in test data sets

### Data Security
1. Never use real user data in tests
2. Use anonymized data for privacy
3. Secure test data storage
4. Rotate test credentials regularly

### Data Localization
1. Provide data in both English and Arabic
2. Test RTL text rendering
3. Include cultural variations
4. Test character encoding

## Data Validation

### Required Fields
- All objects must have unique IDs
- Email addresses must be valid format
- URLs must be accessible
- Dates must be in ISO format

### Data Relationships
- Users must exist before creating channels
- Channels must exist before creating videos
- Videos must exist before creating comments
- Foreign keys must reference existing objects

### Data Consistency
- Language codes must be valid (en, ar)
- Status values must be from allowed sets
- Timestamps must be chronological
- File sizes must be realistic