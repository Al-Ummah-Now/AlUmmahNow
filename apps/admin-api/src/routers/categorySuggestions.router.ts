import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import {
  CategorizeConfigUpdate,
  CategorySuggestionsAccept,
  CategorySuggestionsBackfill,
  CategorySuggestionsList,
  CategorySuggestionsRetry,
  CategorySuggestionsSet,
  CategorySuggestionsStats,
} from '../endpoints/categorySuggestions';

const app = new Hono();
const router = fromHono(app, { base: '' });

// AI category suggestions: review, bulk accept/change, retry, backfill, settings
router.get('/', CategorySuggestionsList);
router.get('/stats', CategorySuggestionsStats);
router.post('/accept', CategorySuggestionsAccept);
router.post('/set', CategorySuggestionsSet);
router.post('/retry', CategorySuggestionsRetry);
router.post('/backfill', CategorySuggestionsBackfill);
router.put('/config', CategorizeConfigUpdate);

export default router;
