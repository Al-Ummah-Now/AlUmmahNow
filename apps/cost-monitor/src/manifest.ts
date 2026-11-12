/**
 * The attribution manifest: the only resources the collector reads, stores or
 * shows (docs/cost-monitoring/README.md §3.2, docs/admin/LIVE_OPS.md §A.1).
 * The account is shared with other projects; anything not listed here is
 * filtered out in the query (`_in`) and dropped again in memory.
 *
 * Names follow the env suffix rule (none = production, `-qa`, `-stage`) except
 * where a worker was named otherwise (web). D1 databases and queues are
 * filtered by id in GraphQL, so their ids are listed with the names.
 */

export const OPS_ENVS = ['production', 'stage', 'qa'] as const;
export type OpsEnv = (typeof OPS_ENVS)[number];
export type ResourceKind = 'worker' | 'd1' | 'r2' | 'queue';

export interface Resource {
  /** '<kind>:<name>' */
  id: string;
  kind: ResourceKind;
  env: OpsEnv;
  name: string;
  /** Cloudflare id for D1 databases and queues (the GraphQL filter key). */
  cfId?: string;
  /** Dead-letter queue: any message in it is an alert. */
  dlq?: boolean;
}

const SUFFIX: Record<OpsEnv, string> = { production: '', stage: '-stage', qa: '-qa' };

/** Workers of this repo, by env. web has its own names. */
const WORKERS: Record<OpsEnv, string[]> = {
  production: ['al-ummah-now-production'],
  stage: ['al-ummah-now-stage'],
  qa: ['al-ummah-web-qa'],
};
const WORKER_BASES = [
  'videos',
  'al-ummah-admin-web',
  'al-ummah-admin-api',
  'al-ummah-now-processor',
  'al-ummah-scheduler',
  'al-ummah-now-comms',
  'al-ummah-now-media',
  'al-ummah-cost-monitor',
];

const BUCKET_BASES = [
  'videos',
  'channels',
  'profiles',
  'playlists',
  'community-posts',
  'subtitles',
  'watch-history',
  'scheduled-videos',
  'al-ummah-now-media',
  'al-ummah-now-media-private',
  'admin-backups',
  'al-ummah-now-sourcemaps',
  'al-ummah-now-messages',
];

const D1: Record<OpsEnv, Record<string, string>> = {
  production: {
    'al-ummah-now-search': '41064871-cf1f-46e9-b102-7b913240ad89',
    'al-ummah-now-reports': '7bee932d-c6b1-47c2-ab70-7dba349104af',
    'al-ummah-now-notifications': '2479ad9b-76f6-41e6-ac77-69e46faa5e69',
    'al-ummah-now-costs': 'af54e39e-6faa-4923-bba3-8dd7b3e58cf7',
  },
  stage: {
    'al-ummah-now-search-stage': '956a3550-bd20-4cfc-9bf2-b1c2265b33dd',
    'al-ummah-now-reports-stage': '2b2c07fc-2823-46e0-958f-acfc401544ff',
    'al-ummah-now-notifications-stage': '8626a5a5-0291-4150-ac9e-6083b606a140',
    'al-ummah-now-costs-stage': 'd4c4d007-c691-4f92-a728-b2ecd706a3ae',
  },
  qa: {
    'al-ummah-now-search-qa': '0282bac3-5b70-4343-a991-937c732d981a',
    'al-ummah-now-reports-qa': 'eed66c4a-af26-4e07-9f9a-36f1e4ada555',
    'al-ummah-now-notifications-qa': '61a2966a-66c2-4ae2-a98f-6e2e8cf6b880',
    'al-ummah-now-costs-qa': 'a83d0ca5-6186-43df-8bc0-90b36561f42d',
  },
};

const QUEUES: Record<OpsEnv, Record<string, string>> = {
  production: {
    'al-ummah-now-videos': '985c9f1cb0fb4ab2b529a2cb75af3a96',
    'al-ummah-now-transcode': 'd14989e73a37443e886167deadbda95b',
    'al-ummah-now-moderation': 'c2ce49cbd6c04d199efd76ba69ce3fb0',
    'al-ummah-now-admin-jobs': '5c8ecbddfab34773ab9380fcdc3b7c6d',
    'al-ummah-now-processing-check': '68760d1f427d4610969ad3e9c1eb4d55',
    'al-ummah-now-errors': '13b10134f49a4ef480464e09e0f55825',
    'al-ummah-now-contact-mail': '86d1036bf5d54a148b2b8e1d41ab14ae',
    'al-ummah-now-dlq': 'e7c3717aa27c4cefa6593992f2db4d25',
    'al-ummah-now-errors-dlq': '2897388a713443f685d4f58cbaf66046',
    'al-ummah-now-transcode-dlq': 'bd1e4bf1d75f433a98a47e48ac1fd502',
  },
  stage: {
    'al-ummah-now-videos-stage': 'be5f4b5be9f94b4381c880c1c608f53c',
    'al-ummah-now-transcode-stage': '828226fd38164770a045fe919bfaf2f1',
    'al-ummah-now-moderation-stage': 'c701c36590b449d0a8b298e8307369ac',
    'al-ummah-now-admin-jobs-stage': 'df7ab0959cbd4241a786cc253d2fb36c',
    'al-ummah-now-processing-check-stage': 'a6471845e3c4433f84b1e698dc541612',
    'al-ummah-now-errors-stage': '1f10f8ece56046469cb8f9330301c69e',
    'al-ummah-now-contact-mail-stage': 'd4f0a6c6d3654430b05b27aa2a336aac',
    'al-ummah-now-dlq-stage': 'f474cf44f9db49a8a52e2acf31ea2f53',
    'al-ummah-now-errors-dlq-stage': 'fd5785933b874d2b91d82c2fd22f0a88',
    'al-ummah-now-transcode-dlq-stage': '1d5e4a1cfafe4aa8bbe0f2db98560be8',
  },
  qa: {
    'al-ummah-now-videos-qa': '0c2bd068d6a7447aadcce2f4622ed706',
    'al-ummah-now-transcode-qa': '8bbac68dcf8d47dcb8107e4080c67326',
    'al-ummah-now-moderation-qa': '8f45b5f9b0d14d57a973137bc0754163',
    'al-ummah-now-admin-jobs-qa': '076078f886cc4877974995e275cc065b',
    'al-ummah-now-processing-check-qa': 'bdaa650aad1946c782847f45dfec6da1',
    'al-ummah-now-errors-qa': '7ad908fa36f04589958cdad80e9bf4c3',
    'al-ummah-now-contact-mail-qa': 'f35992d4204144a3bb2db3822364db84',
    'al-ummah-now-dlq-qa': '1e88cf0787b848bf80ba28d2a8c45f57',
    'al-ummah-now-errors-dlq-qa': 'b767f84fe1544e10b8cff2cc0e2ebc9e',
    'al-ummah-now-transcode-dlq-qa': '9a51a347f30b4c68bdb3092032605419',
  },
};

const isDlqName = (name: string) => /-dlq(-qa|-stage)?$/.test(name);

/** Every manifest resource of the given envs. */
export function manifestFor(envs: readonly OpsEnv[]): Resource[] {
  const out: Resource[] = [];
  for (const env of envs) {
    const s = SUFFIX[env];
    for (const name of [...WORKERS[env], ...WORKER_BASES.map((b) => b + s)]) out.push({ id: `worker:${name}`, kind: 'worker', env, name });
    for (const name of BUCKET_BASES.map((b) => b + s)) out.push({ id: `r2:${name}`, kind: 'r2', env, name });
    for (const [name, cfId] of Object.entries(D1[env])) out.push({ id: `d1:${name}`, kind: 'd1', env, name, cfId });
    for (const [name, cfId] of Object.entries(QUEUES[env])) out.push({ id: `queue:${name}`, kind: 'queue', env, name, cfId, dlq: isDlqName(name) });
  }
  return out;
}

/** Parses COLLECT_ENVS ("production,stage,qa"); unknown names are ignored. */
export function parseEnvs(value: string | undefined): OpsEnv[] {
  const wanted = (value ?? '').split(',').map((s) => s.trim());
  return OPS_ENVS.filter((env) => wanted.includes(env));
}

/** Looks up resources by the key GraphQL groups them by (worker/bucket name, D1/queue id). */
export class ManifestIndex {
  readonly resources: Resource[];
  private byKey = new Map<string, Resource>();

  constructor(resources: Resource[]) {
    this.resources = resources;
    for (const r of resources) this.byKey.set(`${r.kind}|${r.cfId ?? r.name}`, r);
  }

  /** The manifest resource, or undefined: such a row is never stored. */
  find(kind: ResourceKind, key: string): Resource | undefined {
    return this.byKey.get(`${kind}|${key}`);
  }

  keys(kind: ResourceKind): string[] {
    return this.resources.filter((r) => r.kind === kind).map((r) => r.cfId ?? r.name);
  }
}
