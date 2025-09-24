import { NextRequest, NextResponse } from 'next/server';
import { authenticated } from '@/lib/actions';
import { VideosAPI } from '@/lib/api';

// Maximum file size: 2GB
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

// Allowed video formats
const ALLOWED_TYPES = ['video/mp4', 'video/mov', 'video/avi', 'video/webm'];

interface BunnyUploadResponse {
  success: boolean;
  guid?: string;
  statusCode: number;
  message?: string;
}

interface VideoUploadResult {
  video: {
    id: string;
    title: string;
    description?: string;
    videoUrl: string;
    thumbnailUrl?: string;
    userId: string;
    channelId: string;
    isPublic: boolean;
  };
}

async function uploadToBunny(
  file: File,
  videoGuid: string,
  bunnyVideoKey: string,
  bunnyVideoZone: string
): Promise<BunnyUploadResponse> {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(
      `https://video.bunnycdn.com/library/${bunnyVideoZone}/videos/${videoGuid}`,
      {
        method: 'PUT',
        headers: {
          'AccessKey': bunnyVideoKey,
        },
        body: await file.arrayBuffer(),
      }
    );

    if (!response.ok) {
      throw new Error(`Bunny upload failed: ${response.status} ${response.statusText}`);
    }

    return {
      success: true,
      guid: videoGuid,
      statusCode: response.status,
    };
  } catch (error) {
    console.error('Bunny upload error:', error);
    return {
      success: false,
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Upload failed',
    };
  }
}

async function createBunnyVideo(
  title: string,
  bunnyVideoKey: string,
  bunnyVideoZone: string
): Promise<{ success: boolean; guid?: string; message?: string }> {
  try {
    const response = await fetch(
      `https://video.bunnycdn.com/library/${bunnyVideoZone}/videos`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'AccessKey': bunnyVideoKey,
        },
        body: JSON.stringify({
          title,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to create Bunny video: ${response.status}`);
    }

    const result = await response.json() as { guid?: string };
    return {
      success: true,
      guid: result.guid,
    };
  } catch (error) {
    console.error('Create Bunny video error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create video',
    };
  }
}

async function uploadToCloudflareR2(
  file: File,
  key: string,
  r2Bucket: R2Bucket
): Promise<boolean> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    
    await r2Bucket.put(key, arrayBuffer, {
      httpMetadata: {
        contentType: file.type,
      },
      customMetadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
      },
    });

    return true;
  } catch (error) {
    console.error('R2 upload error:', error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const subject = await authenticated();
    if (!subject || !subject.properties) {
      return NextResponse.json(
        { success: false, message: 'Authentication required' },
        { status: 401 }
      );
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('video') as File;
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const isPublic = formData.get('isPublic') === 'true';

    // Validation
    if (!file) {
      return NextResponse.json(
        { success: false, message: 'No video file provided' },
        { status: 400 }
      );
    }

    if (!title?.trim()) {
      return NextResponse.json(
        { success: false, message: 'Video title is required' },
        { status: 400 }
      );
    }

    // File validation
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, message: 'Invalid file type. Please upload MP4, MOV, AVI, or WebM files.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, message: 'File size exceeds 2GB limit' },
        { status: 400 }
      );
    }

    // Get environment variables
    const bunnyVideoKey = process.env.BunnyVideoKey;
    const bunnyVideoZone = process.env.BunnyVideoZone;
    
    if (!bunnyVideoKey || !bunnyVideoZone) {
      console.error('Missing Bunny.net configuration');
      return NextResponse.json(
        { success: false, message: 'Upload service configuration error' },
        { status: 500 }
      );
    }

    // Step 1: Create video entry in Bunny.net
    const bunnyVideoResult = await createBunnyVideo(title, bunnyVideoKey, bunnyVideoZone);
    if (!bunnyVideoResult.success || !bunnyVideoResult.guid) {
      return NextResponse.json(
        { success: false, message: bunnyVideoResult.message || 'Failed to initialize video upload' },
        { status: 500 }
      );
    }

    const videoGuid = bunnyVideoResult.guid;

    // Step 2: Upload file to Bunny.net
    const uploadResult = await uploadToBunny(file, videoGuid, bunnyVideoKey, bunnyVideoZone);
    if (!uploadResult.success) {
      return NextResponse.json(
        { success: false, message: uploadResult.message || 'Video upload failed' },
        { status: 500 }
      );
    }

    // Step 3: Also upload to Cloudflare R2 as backup (if available)
    try {
      // Get R2 bucket from context (available in Cloudflare Workers)
      const context = (globalThis as any).process?.env?.CLOUDFLARE_ENV_CONTEXT;
      if (context?.videos) {
        const r2Key = `videos/${subject.properties.id}/${videoGuid}/${file.name}`;
        await uploadToCloudflareR2(file, r2Key, context.videos);
      }
    } catch (error) {
      // R2 upload is optional backup, don't fail if it doesn't work
      console.warn('R2 backup upload failed:', error);
    }

    // Step 4: Create video record in our API
    const videoUrl = `https://iframe.mediadelivery.net/embed/${bunnyVideoZone}/${videoGuid}`;
    const thumbnailUrl = `https://${bunnyVideoZone}.b-cdn.net/${videoGuid}/thumbnail.jpg`;

    const videoData = {
      title: title.trim(),
      description: description?.trim() || null,
      videoUrl,
      thumbnailUrl,
      isPublic,
      isLive: false,
    };

    // TODO: Replace with actual user's channel ID
    const headers = {
      channelId: subject.properties.id, // Using user ID as channel ID for now
      userId: subject.properties.id,
    };

    const apiResult = await VideosAPI.create(videoData, headers);
    if (!apiResult) {
      // Even if our API fails, the video is uploaded to Bunny
      console.error('Failed to create video record in API');
      return NextResponse.json(
        { success: false, message: 'Video uploaded but failed to create record' },
        { status: 500 }
      );
    }

    // Success response
    const response: VideoUploadResult = {
      video: {
        id: apiResult.result?.video.id || videoGuid,
        title: title.trim(),
        description: description?.trim(),
        videoUrl,
        thumbnailUrl,
        userId: subject.properties.id,
        channelId: subject.properties.id,
        isPublic,
      },
    };

    return NextResponse.json({
      success: true,
      ...response,
    });

  } catch (error) {
    console.error('Upload API error:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: 'Internal server error during upload' 
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { message: 'Video upload endpoint. Use POST to upload videos.' },
    { status: 200 }
  );
}