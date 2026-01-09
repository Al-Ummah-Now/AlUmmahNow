/**
 * Video frame extraction utility
 * Extracts frames from video files for thumbnail preview
 */

export interface FrameExtractionOptions {
  positions: number[]; // Percentages (0-100)
  width?: number;
  height?: number;
  quality?: number;
}

/**
 * Extract frames from video file at specified positions
 * @param videoFile - Video file to extract frames from
 * @param positions - Array of positions (0-100%) where to extract frames
 * @returns Promise<string[]> - Array of base64 encoded frame images
 */
export async function extractVideoFrames(
  videoFile: File,
  positions: number[] = [10, 25, 50, 75, 90]
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    const frames: string[] = [];
    let currentPositionIndex = 0;

    // Create object URL for video
    video.src = URL.createObjectURL(videoFile);
    video.preload = 'metadata';

    // Set canvas dimensions (16:9 aspect ratio)
    canvas.width = 1280;
    canvas.height = 720;

    // Handle video metadata loaded
    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration;

      if (!duration || duration === 0) {
        URL.revokeObjectURL(video.src);
        reject(new Error('Invalid video duration'));
        return;
      }

      // Start capturing frames
      captureNextFrame();
    });

    // Handle video seeking
    video.addEventListener('seeked', () => {
      try {
        // Draw current frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Convert canvas to base64 JPEG
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        frames.push(dataUrl);

        // Move to next position
        currentPositionIndex++;
        captureNextFrame();
      } catch (error) {
        URL.revokeObjectURL(video.src);
        reject(error);
      }
    });

    // Handle errors
    video.addEventListener('error', () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Failed to load video'));
    });

    // Capture frame at current position
    function captureNextFrame() {
      if (currentPositionIndex >= positions.length) {
        // All frames captured
        URL.revokeObjectURL(video.src);
        resolve(frames);
        return;
      }

      const position = positions[currentPositionIndex];
      const time = (position / 100) * video.duration;

      // Seek to position
      video.currentTime = time;
    }
  });
}

/**
 * Extract a single frame from video at specific position
 * @param videoFile - Video file to extract frame from
 * @param position - Position (0-100%) where to extract frame
 * @param width - Optional frame width (default: 1280)
 * @param height - Optional frame height (default: 720)
 * @param quality - Optional JPEG quality (0-1, default: 0.9)
 * @returns Promise<string> - Base64 encoded frame image
 */
export async function extractSingleFrame(
  videoFile: File,
  position: number = 50,
  width: number = 1280,
  height: number = 720,
  quality: number = 0.9
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    video.src = URL.createObjectURL(videoFile);
    video.preload = 'metadata';
    canvas.width = width;
    canvas.height = height;

    video.addEventListener('loadedmetadata', () => {
      const time = (position / 100) * video.duration;
      video.currentTime = time;
    });

    video.addEventListener('seeked', () => {
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        URL.revokeObjectURL(video.src);
        resolve(dataUrl);
      } catch (error) {
        URL.revokeObjectURL(video.src);
        reject(error);
      }
    });

    video.addEventListener('error', () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Failed to load video'));
    });
  });
}

/**
 * Get video duration
 * @param videoFile - Video file to get duration from
 * @returns Promise<number> - Duration in seconds
 */
export async function getVideoDuration(videoFile: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.preload = 'metadata';

    video.addEventListener('loadedmetadata', () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    });

    video.addEventListener('error', () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Failed to load video'));
    });
  });
}

/**
 * Validate if file is a valid video
 * @param file - File to validate
 * @returns boolean - True if file is a valid video
 */
export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}
