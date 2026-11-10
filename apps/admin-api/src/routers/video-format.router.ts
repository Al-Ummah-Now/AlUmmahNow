import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { VideoFormatFlagged, VideoFormatLatestRun, VideoFormatSet, VideoFormatStartBackfill } from '../endpoints/videoFormat/VideoFormatAdmin';

const app = new Hono();
const videoFormatRouter = fromHono(app, { base: '' });

// Short vs video formats (admin-web /video-formats)
videoFormatRouter.get('/runs/latest', VideoFormatLatestRun);
videoFormatRouter.post('/backfill', VideoFormatStartBackfill);
videoFormatRouter.get('/flagged', VideoFormatFlagged);
videoFormatRouter.post('/set', VideoFormatSet);

export default videoFormatRouter;
