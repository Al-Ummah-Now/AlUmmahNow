/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

const src = (file: string) => fs.readFileSync(path.join(process.cwd(), 'src', file), 'utf8');

/**
 * An open page reconnects for hours, across releases. A server action of a release that is gone answers
 * without flight data (prod 2026-11-25: "can't access property map, e is undefined").
 */
describe('the realtime token on (re)connect', () => {
  it.each(['lib/websocket/WebSocketProvider.tsx', 'hooks/useVideoWebSocket.ts'])('%s reads it from the route handler, not a server action', (file) => {
    expect(src(file)).toContain("import { fetchRealtimeToken } from '@/lib/auth/client-token'");
    expect(src(file)).not.toContain('@/lib/actions');
  });
});
