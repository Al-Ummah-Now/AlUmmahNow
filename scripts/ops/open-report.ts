/**
 * Opens a sealed ops report (the artifact of Prod errors or Media diagnostics) on your own computer:
 *
 *   gh run download <run id> -n prod-errors-production -D <folder>
 *   node --experimental-strip-types scripts/ops/open-report.ts <folder>/report.sealed.json [--key <private key .pem>]
 *
 * The private key is outside every repository; the default place is .ops-keys/ops-report.key.pem beside the clone.
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unseal, type SealedReport } from './seal.ts';

const args = process.argv.slice(2);
const at = args.indexOf('--key');
const keyPath = at >= 0 ? args[at + 1]! : join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.ops-keys', 'ops-report.key.pem');
const file = args.find((a, i) => a !== '--key' && (at < 0 || i !== at + 1));
if (!file) throw new Error('usage: open-report.ts <report.sealed.json> [--key <private key .pem>]');
if (statSync(keyPath).mode & 0o077) throw new Error('The private key must be readable by you only (chmod 600)');
process.stdout.write(unseal(JSON.parse(readFileSync(file, 'utf8')) as SealedReport, readFileSync(keyPath, 'utf8')));
