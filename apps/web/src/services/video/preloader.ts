interface PreloadResult {
  success: boolean;
  segmentsLoaded: number;
  totalSegments: number;
}

export const preloadVideo = async (
  videoSrc: string,
  segmentCount: number = 3
): Promise<PreloadResult> => {
  try {
    const manifestResponse = await fetch(videoSrc, {
      headers: { 'Range': 'bytes=0-4096' }
    });

    if (manifestResponse.ok) {
      const manifestText = await manifestResponse.text();
      const segmentUrls = parseManifestForSegments(manifestText, videoSrc);
      const segmentsToPreload = segmentUrls.slice(0, segmentCount);
      let loadedSegments = 0;

      await Promise.all(
        segmentsToPreload.map(async (segmentUrl) => {
          try {
            const response = await fetch(segmentUrl, {
              headers: { 'Range': 'bytes=0-1024' }
            });
            if (response.ok) {
              loadedSegments++;
            }
          } catch (_error) {
            console.warn('Failed to preload segment:', segmentUrl);
          }
        })
      );

      return {
        success: true,
        segmentsLoaded: loadedSegments,
        totalSegments: segmentsToPreload.length
      };
    }
  } catch (error) {
    console.warn('Preload failed:', error);
  }

  return {
    success: false,
    segmentsLoaded: 0,
    totalSegments: 0
  };
};

const parseManifestForSegments = (manifest: string, baseUrl: string): string[] => {
  const lines = manifest.split('\n');
  const segments: string[] = [];
  const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);

  for (const line of lines) {
    if (line.trim() && !line.startsWith('#')) {
      segments.push(line.startsWith('http') ? line : base + line.trim());
    }
  }

  return segments;
};

export { parseManifestForSegments };
