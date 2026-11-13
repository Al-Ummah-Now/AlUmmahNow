/** Container uploads into R2 (Transcoder's media and mp4 outbound handlers). */
import { mediaCacheControl, mediaContentType } from '@al-ummah/shared-types';

/**
 * Store a container upload. A body with a Content-Length is streamed into R2 (a Worker holds 128 MB,
 * and the progressive MP4 of a long video is larger); without one it is read whole.
 */
export async function storeUpload(bucket: R2Bucket, key: string, req: Request): Promise<void> {
	const options = { httpMetadata: { contentType: mediaContentType(key), cacheControl: mediaCacheControl(key) } };
	const length = Number(req.headers.get('content-length'));
	if (req.body && Number.isSafeInteger(length) && length > 0) {
		const { readable, writable } = new FixedLengthStream(length);
		const [, stored] = await Promise.all([req.body.pipeTo(writable), bucket.put(key, readable, options)]);
		if (!stored) throw new Error('R2 refused the upload');
		return;
	}
	await bucket.put(key, await req.arrayBuffer(), options);
}
