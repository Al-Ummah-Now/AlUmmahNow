import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('the MCP process validates tool-specific arguments before accessing logs', async () => {
  const client = new Client({ name: 'log-input-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/index.ts'],
    env: { LOG_SERVICE_URL: 'http://127.0.0.1:1' },
  });
  await client.connect(transport);
  try {
    for (const call of [
      { name: 'get_logs', arguments: { lines: '10' } },
      { name: 'watch_logs', arguments: { duration: 0 } },
      { name: 'search_logs', arguments: { query: '' } },
      { name: 'list_log_apps', arguments: { unexpected: true } },
    ]) {
      const result = await client.callTool(call);
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /Invalid tool arguments/);
    }
  } finally {
    await client.close();
  }
});
