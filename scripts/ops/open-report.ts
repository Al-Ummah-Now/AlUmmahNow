/**
 * Opens a sealed ops report (the artifact of Prod errors or Media diagnostics) on your own computer:
 *
 *   gh run download <run id> -n prod-errors-production -D <folder>
 *   node --experimental-strip-types scripts/ops/open-report.ts <folder>/report.sealed.json [--key <private key .pem>]
 *
 * The private key is outside every repository. Without --key or OPS_REPORT_KEY it is looked for at
 * ../.ops-keys/ops-report.key.pem, beside the clone or worktree this script is in: from a clone elsewhere, pass it.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unseal, type SealedReport } from './seal.ts';

const args = process.argv.slice(2);
const at = args.indexOf('--key');
const keyPath = at >= 0 ? args[at + 1]! : process.env.OPS_REPORT_KEY || join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.ops-keys', 'ops-report.key.pem');
const file = args.find((a, i) => a !== '--key' && (at < 0 || i !== at + 1));
if (!file) throw new Error('usage: open-report.ts <report.sealed.json> [--key <private key .pem>]');
if (!existsSync(keyPath)) throw new Error(`No private key at ${keyPath}: pass --key <path> or set OPS_REPORT_KEY`);
if (statSync(keyPath).mode & 0o077) throw new Error('The private key must be readable by you only (chmod 600)');
process.stdout.write(unseal(JSON.parse(readFileSync(file, 'utf8')) as SealedReport, readFileSync(keyPath, 'utf8')));
