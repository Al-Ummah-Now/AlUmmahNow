/**
 * Writes the public API contract (openapi/v1.json) from the real routers.
 *   pnpm --filter @al-ummah/api-videos openapi:generate
 * test/openapi-contract.spec.ts fails CI when the checked-in file drifts.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getContractDocument } from '../src/index';
import { serializeContract } from '../src/lib/api-contract';

export const CONTRACT_FILE = join(__dirname, '..', 'openapi', 'v1.json');

(async () => {
	const doc = await getContractDocument();
	writeFileSync(CONTRACT_FILE, serializeContract(doc));
	process.stdout.write(`wrote ${CONTRACT_FILE}: ${Object.keys(doc.paths).length} paths\n`);
})();
