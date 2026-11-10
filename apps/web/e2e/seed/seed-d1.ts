import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { seedLogger as log } from './seed-logger';

/**
 * Minimal wrangler wrapper for the OpenAuth D1 database (users + rbac tables).
 *
 * `wrangler d1 execute --command` has no bind parameters, so every value that
 * is interpolated into SQL is validated against a strict pattern first.
 * Auth: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in CI, or an existing
 * `wrangler login` session locally.
 */

export interface D1Config {
  databaseName: string;
  databaseId: string;
}

const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_EMAIL = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

function sqlString(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) throw new Error(`Refusing to interpolate unsafe ${label} into SQL`);
  return `'${value}'`;
}

export class D1Client {
  private configPath: string;

  constructor(private cfg: D1Config) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-qa-d1-'));
    this.configPath = path.join(dir, 'wrangler.toml');
    fs.writeFileSync(
      this.configPath,
      [
        'name = "seed-qa-d1"',
        'compatibility_date = "2025-01-01"',
        '',
        '[[d1_databases]]',
        'binding = "DB"',
        `database_name = "${cfg.databaseName}"`,
        `database_id = "${cfg.databaseId}"`,
        '',
      ].join('\n'),
    );
  }

  private execute<T>(sql: string): T[] {
    const bin = process.env.WRANGLER_BIN || 'npx';
    const prefix = process.env.WRANGLER_BIN ? [] : ['--yes', 'wrangler'];
    const args = [...prefix, 'd1', 'execute', this.cfg.databaseName, '--remote', '--json', '--config', this.configPath, '--command', sql];
    log.debug('D1 execute', { sql });
    let stdout: string;
    try {
      stdout = execFileSync(bin, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: process.env.CI || 'true' },
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch (error) {
      const e = error as { stderr?: string; stdout?: string; message?: string };
      throw new Error(`wrangler d1 execute failed: ${(e.stderr || e.stdout || e.message || '').toString().slice(0, 2000)}`);
    }
    const start = stdout.indexOf('[');
    if (start < 0) throw new Error(`Unexpected wrangler output: ${stdout.slice(0, 500)}`);
    const parsed = JSON.parse(stdout.slice(start)) as Array<{ results?: T[]; success?: boolean }>;
    if (!parsed.every((r) => r.success !== false)) throw new Error('D1 statement reported success=false');
    return parsed.flatMap((r) => r.results || []);
  }

  /**
   * Gives a user a creator tier (videos search D1: creator_tier_assignments).
   * Uploading and creating channels are by invitation, so accounts that seed
   * channels and videos need one. Idempotent; never downgrades an existing tier.
   */
  ensureCreatorTier(userId: string, tierId: string): 'created' | 'exists' {
    const user = sqlString(userId, SAFE_ID, 'user id');
    const tier = sqlString(tierId, SAFE_ID, 'tier id');
    const existing = this.execute<{ tier_id: string }>(`SELECT tier_id FROM creator_tier_assignments WHERE user_id = ${user}`);
    if (existing.length > 0) return 'exists';
    this.execute(
      `INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES (${user}, ${tier}, 'admin', 'seed', '${new Date().toISOString()}')`,
    );
    return 'created';
  }

  /** Returns a map of email -> user id for the given emails (exact match). */
  findUserIdsByEmail(emails: string[]): Map<string, string> {
    if (emails.length === 0) return new Map();
    const list = emails.map((e) => sqlString(e, SAFE_EMAIL, 'email')).join(', ');
    const rows = this.execute<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE email IN (${list}) AND deleted_at IS NULL`,
    );
    return new Map(rows.map((r) => [r.email, r.id]));
  }

  listRoles(userId: string): string[] {
    const rows = this.execute<{ role_id: string }>(
      `SELECT role_id FROM rbac_user_roles WHERE user_id = ${sqlString(userId, SAFE_ID, 'user id')} AND tenant_id = 'default'`,
    );
    return rows.map((r) => r.role_id);
  }

  /** Whether this auth database defines the role (stage mirrors production's roles, QA has more). */
  roleExists(roleId: string): boolean {
    return this.execute<{ id: string }>(`SELECT id FROM rbac_roles WHERE id = ${sqlString(roleId, SAFE_ID, 'role id')}`).length > 0;
  }

  /** Idempotent role grant. Returns true when a row was inserted. */
  assignRole(userId: string, roleId: string): boolean {
    const before = this.listRoles(userId);
    if (before.includes(roleId)) return false;
    this.execute(
      `INSERT OR IGNORE INTO rbac_user_roles (user_id, role_id, tenant_id, assigned_at, assigned_by) VALUES (${sqlString(userId, SAFE_ID, 'user id')}, ${sqlString(roleId, SAFE_ID, 'role id')}, 'default', unixepoch()*1000, 'seed-qa')`,
    );
    const after = this.listRoles(userId);
    if (!after.includes(roleId)) throw new Error(`Role ${roleId} was not persisted for user ${userId}`);
    return true;
  }
}
