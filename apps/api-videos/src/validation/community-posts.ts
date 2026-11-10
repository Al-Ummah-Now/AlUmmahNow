import { PostType } from '@al-ummah/shared-types';

export async function validateCreatePost(data: any, user: any) {
  const errors = [];

  // Check channel ownership
  if (!user.channelId) {
    return { valid: false, error: 'User does not own a channel' };
  }

  // Validate by type
  switch (data.type) {
    case PostType.TEXT:
      if (!data.content || data.content.trim().length === 0) {
        errors.push('Text posts must have content');
      }
      if (data.content && data.content.length > 5000) {
        errors.push('Text content cannot exceed 5000 characters');
      }
      break;

    case PostType.IMAGE:
      if (!data.images || data.images.length === 0) {
        errors.push('Image posts must have at least one image');
      }
      if (data.images?.length > 10) {
        errors.push('Maximum 10 images allowed');
      }
      // Validate each image
      data.images?.forEach((img: any, idx: number) => {
        if (img.size > 16 * 1024 * 1024) {
          errors.push(`Image ${idx + 1} exceeds 16MB limit`);
        }
        if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(img.mimeType)) {
          errors.push(`Image ${idx + 1} has invalid format`);
        }
      });
      break;

    case PostType.POLL:
      if (!data.poll) {
        errors.push('Poll data is required for poll posts');
      }
      if (!data.poll?.question) {
        errors.push('Poll must have a question');
      }
      if (data.poll?.options?.length < 2 || data.poll?.options?.length > 5) {
        errors.push('Polls must have 2-5 options');
      }
      // Validate poll options
      data.poll?.options?.forEach((opt: any, idx: number) => {
        if (!opt.text && !opt.image) {
          errors.push(`Poll option ${idx + 1} must have text or image`);
        }
        if (opt.text && opt.text.length > 65) {
          errors.push(`Poll option ${idx + 1} text exceeds 65 characters`);
        }
        if (opt.image?.caption && opt.image.caption.length > 36) {
          errors.push(`Poll option ${idx + 1} caption exceeds 36 characters`);
        }
      });
      // Validate voting end time
      if (data.poll?.votingEndsAt) {
        const endTime = new Date(data.poll.votingEndsAt);
        const maxTime = new Date();
        maxTime.setDate(maxTime.getDate() + 7);
        if (endTime > maxTime) {
          errors.push('Poll voting period cannot exceed 7 days');
        }
        if (endTime <= new Date()) {
          errors.push('Poll voting end time must be in the future');
        }
      }
      break;

    case PostType.QUIZ:
      if (!data.quiz) {
        errors.push('Quiz data is required for quiz posts');
      }
      if (!data.quiz?.question) {
        errors.push('Quiz must have a question');
      }
      if (data.quiz?.options?.length < 2 || data.quiz?.options?.length > 4) {
        errors.push('Quizzes must have 2-4 options');
      }
      if (!data.quiz?.correctOptionId) {
        errors.push('Quiz must have a correct answer');
      }
      // Validate quiz options
      data.quiz?.options?.forEach((opt: any, idx: number) => {
        if (!opt.text) {
          errors.push(`Quiz option ${idx + 1} must have text`);
        }
        const maxLength = opt.image ? 30 : 80;
        if (opt.text && opt.text.length > maxLength) {
          errors.push(`Quiz option ${idx + 1} text exceeds ${maxLength} characters`);
        }
      });
      if (data.quiz?.explanation && data.quiz.explanation.length > 500) {
        errors.push('Quiz explanation exceeds 500 characters');
      }
      break;

    case PostType.VIDEO:
      if (!data.videoId) {
        errors.push('Video posts must reference a video');
      }
      break;

    case PostType.GIF:
      if (!data.gif) {
        errors.push('GIF posts must have a GIF');
      }
      break;

    default:
      errors.push(`Invalid post type: ${data.type}`);
  }

  // Check rate limiting (example: max 10 posts per day)
  // This would need to track posts per channel in R2 or KV

  if (errors.length > 0) {
    return { valid: false, error: errors.join(', ') };
  }

  return { valid: true };
}

export async function validateUpdatePost(data: any, existingPost: any, user: any) {
  // A scholar's article is written in the CMS and synced from there (lib/scholar-articles.ts).
  if (existingPost.type === PostType.ARTICLE) {
    return { valid: false, error: 'article_managed_in_cms' };
  }
  // Check ownership
  if (existingPost.channelId !== user.channelId) {
    return { valid: false, error: 'You can only edit your own posts' };
  }

  // Cannot update polls/quizzes after creation
  if (existingPost.type === PostType.POLL && data.poll) {
    return { valid: false, error: 'Cannot modify poll options after creation' };
  }

  if (existingPost.type === PostType.QUIZ && data.quiz) {
    return { valid: false, error: 'Cannot modify quiz after creation' };
  }

  // Cannot update if voting has started
  if (existingPost.poll?.totalVotes > 0 && (data.poll || data.content)) {
    return { valid: false, error: 'Cannot modify post after voting has started' };
  }

  // Validate text content if provided
  if (data.content !== undefined && data.content.length > 5000) {
    return { valid: false, error: 'Text content cannot exceed 5000 characters' };
  }

  return { valid: true };
}