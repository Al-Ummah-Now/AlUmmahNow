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

/** Longest edge of an extracted frame (1280 keeps 16:9 frames at the familiar 1280x720). */
export const FRAME_MAX_EDGE = 1280;

/**
 * Canvas size for a frame of a `videoWidth` x `videoHeight` video: the video's
 * own aspect ratio with the longest edge at `maxEdge`, so a 1920x1080 video
 * gives 1280x720, a 1080x1920 one 720x1280 and a 426x240 clip 1280x721 (small
 * clips are scaled up, as before, so frames clear the 320x180 thumbnail
 * minimum). A fixed 1280x720 canvas stretched every vertical, square or 4:3
 * video into 16:9 (2026-11-10: "thumbs don't match aspect").
 * Falls back to 16:9 when the browser reports no dimensions.
 */
export function frameCaptureSize(
  videoWidth: number,
  videoHeight: number,
  maxEdge: number = FRAME_MAX_EDGE
): { width: number; height: number } {
  if (!(videoWidth > 0) || !(videoHeight > 0) || !Number.isFinite(videoWidth) || !Number.isFinite(videoHeight)) {
    return { width: maxEdge, height: Math.round((maxEdge * 9) / 16) };
  }
  const scale = maxEdge / Math.max(videoWidth, videoHeight);
  return {
    width: Math.max(1, Math.round(videoWidth * scale)),
    height: Math.max(1, Math.round(videoHeight * scale)),
  };
}

/** Size `canvas` to the loaded video's real aspect ratio. */
function sizeCanvasToVideo(canvas: HTMLCanvasElement, video: HTMLVideoElement, maxEdge?: number): void {
  const { width, height } = frameCaptureSize(video.videoWidth, video.videoHeight, maxEdge);
  canvas.width = width;
  canvas.height = height;
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

    // Handle video metadata loaded
    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration;
      // The frame keeps the video's own aspect ratio (vertical, square, 4:3…)
      sizeCanvasToVideo(canvas, video);

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
 * @param maxEdge - Optional longest edge of the frame (default: 1280); the
 *   frame keeps the video's aspect ratio
 * @param quality - Optional JPEG quality (0-1, default: 0.9)
 * @returns Promise<string> - Base64 encoded frame image
 */
export async function extractSingleFrame(
  videoFile: File,
  position: number = 50,
  maxEdge: number = FRAME_MAX_EDGE,
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

    video.addEventListener('loadedmetadata', () => {
      sizeCanvasToVideo(canvas, video, maxEdge);
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
