/**
 * Move from YouTube (wiki AUN-YT-IMPORT). Base: /api/youtube-import (served under /api/v1/).
 * The OAuth callback is a plain route in index.ts (Google's redirect carries no bearer token).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import {
	YoutubeImportAvailable,
	YoutubeImportCancel,
	YoutubeImportGet,
	YoutubeImportLinkBack,
	YoutubeImportMatches,
	YoutubeImportOAuthFinish,
	YoutubeImportOAuthStart,
	YoutubeImportRetryItem,
	YoutubeImportSelection,
	YoutubeImportStart,
	YoutubeImportStatus,
} from '../endpoints/youtube-import/youtubeImport';

export const youtubeImportRouter = fromHono(new Hono());
youtubeImportRouter.get('/available', YoutubeImportAvailable);
youtubeImportRouter.get('/status', YoutubeImportStatus);
youtubeImportRouter.post('/oauth/start', YoutubeImportOAuthStart);
youtubeImportRouter.post('/oauth/finish', YoutubeImportOAuthFinish);
youtubeImportRouter.get('/:importId', YoutubeImportGet);
youtubeImportRouter.put('/:importId/selection', YoutubeImportSelection);
youtubeImportRouter.put('/:importId/matches', YoutubeImportMatches);
youtubeImportRouter.post('/:importId/start', YoutubeImportStart);
youtubeImportRouter.post('/:importId/items/:itemId/retry', YoutubeImportRetryItem);
youtubeImportRouter.post('/:importId/cancel', YoutubeImportCancel);
youtubeImportRouter.get('/:importId/link-back.csv', YoutubeImportLinkBack);
