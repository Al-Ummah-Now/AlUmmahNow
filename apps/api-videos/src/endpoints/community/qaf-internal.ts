import { Hono } from 'hono';
import { resolveNeedsAction, type ErrorReporterEnv } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';
import { QafError, readQafSettings, saveQafSettings, type QafEnv } from '../../lib/qaf/service';
import { qafActionKey } from './qaf';

const router = new Hono<{ Bindings: QafEnv & ErrorReporterEnv }>();
router.onError((error, c) => {
  if (error instanceof QafError) return c.json({ error: error.code }, error.status);
  logger.error('[Qaf] Platform settings operation failed', { method: c.req.method });
  return c.json({ error: 'unavailable' }, 503);
});
router.get('/', async (c) => c.json({ success: true, result: await readQafSettings(c.env) }));
router.put('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = await saveQafSettings(c.env, body);
  if (body.key !== undefined) {
    resolveNeedsAction(c.env, c.executionCtx, [qafActionKey('invalid_keys'), qafActionKey('week')]);
  }
  return c.json({ success: true, result });
});

export default router;
