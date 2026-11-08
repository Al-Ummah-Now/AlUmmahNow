/**
 * Secrets and client ids each deployed Worker needs, per env (AlUmmahNow).
 * Read by check-secrets.ts and documented in README.md ("Secrets per app").
 * Names and purposes only: never put a value here.
 *
 * When code starts reading a new secret, add it here in the same PR.
 * Stage entries get added when the apps join the stage env.
 */
export type EnvName = 'production' | 'qa' | 'stage';

/** Auth D1 (oauth_clients, in AlUmmahNowAuth) for each env. */
export const AUTH_DBS: Record<EnvName, string> = {
	production: 'af76f007-e21e-43aa-88de-ebfefe46fb56', // al-ummah-now-d1
	qa: '28590f3c-dd92-4c26-a803-d73a9bbe2b58', // al-ummah-now-d1-qa
	stage: 'c7886ef6-c70b-4b7f-a65b-3df9f9aba9e2', // al-ummah-now-d1-stage
};

export interface RequiredSecret {
	name: string;
	purpose: string;
}

export interface WorkerSecrets {
	app: string;
	env: EnvName;
	worker: string;
	required?: RequiredSecret[];
	/** Must NOT be bound in this env (test-only secrets in production). */
	forbidden?: string[];
	/**
	 * Plain vars holding an oauth_clients id; checked against AUTH_DBS[env].
	 * required: the app starts logins with it (web, admin-web). Resource servers
	 * only verify tokens, so their ClientId is checked only when set.
	 */
	clientIdVars?: { name: string; required: boolean }[];
	/** Client ids hard-coded in the app; checked against AUTH_DBS[env]. */
	fixedClientIds?: string[];
}

const INTERNAL_API_KEY: RequiredSecret = {
	name: 'INTERNAL_API_KEY',
	purpose: 'Secrets Store internal-api-key[-qa]; X-API-Key between our Workers and for /internal/* routes',
};

const API_VIDEOS_SECRETS: RequiredSecret[] = [
	{ name: 'bunny-stream-key', purpose: 'Secrets Store; Bunny Stream API key (create, upload, update videos)' },
	{ name: 'bunny_stream_library_id', purpose: 'Secrets Store; Bunny Stream library id' },
	{ name: 'BUNNY_TOKEN_KEY', purpose: 'Secrets Store; signs Bunny CDN playback and thumbnail URLs' },
	{ name: 'image_storage_key', purpose: 'Secrets Store; Bunny Storage key for thumbnails and avatars' },
	INTERNAL_API_KEY,
];

const CLIENT_REQUIRED = [{ name: 'ClientId', required: true }];
const CLIENT_OPTIONAL = [{ name: 'ClientId', required: false }];

type Make = Omit<WorkerSecrets, 'env' | 'worker'>;
function both(prod: string, qa: string, spec: Make): WorkerSecrets[] {
	return [
		{ ...spec, env: 'production', worker: prod },
		{ ...spec, env: 'qa', worker: qa },
	];
}

export const SECRETS_MANIFEST: WorkerSecrets[] = [
	...both('al-ummah-now-production', 'al-ummah-web-qa', { app: 'web', clientIdVars: CLIENT_REQUIRED }),
	...both('al-ummah-admin-web', 'al-ummah-admin-web-qa', { app: 'admin-web', clientIdVars: CLIENT_REQUIRED }),
	...both('videos', 'videos-qa', { app: 'api-videos', required: API_VIDEOS_SECRETS, clientIdVars: CLIENT_OPTIONAL }),
	...both('al-ummah-admin-api', 'al-ummah-admin-api-qa', { app: 'admin-api', required: [INTERNAL_API_KEY], clientIdVars: CLIENT_OPTIONAL }),
	...both('al-ummah-now-comms', 'al-ummah-now-comms-qa', {
		app: 'websocket-server',
		required: [INTERNAL_API_KEY],
		clientIdVars: CLIENT_OPTIONAL,
	}),
	...both('al-ummah-now-processor', 'al-ummah-now-processor-qa', { app: 'processor', required: [INTERNAL_API_KEY] }),
	...both('al-ummah-scheduler', 'al-ummah-scheduler-qa', { app: 'scheduler', required: [INTERNAL_API_KEY] }),
];
