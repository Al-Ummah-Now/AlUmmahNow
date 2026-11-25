/**
 * Every videos-admin help area, in guide order. `pnpm check:admin-help` fails when a JSON file in
 * this folder is missing here.
 */
import type { HelpArea } from '../../src/types.ts';
import platformSettings from './platform-settings.json' with { type: 'json' };

export const VIDEOS_ADMIN_HELP: readonly HelpArea[] = [platformSettings as HelpArea];
