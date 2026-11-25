/**
 * Where a slow request's time went (server only: imports node:async_hooks, needs nodejs_compat; import it
 * from `@al-ummah/shared-types/request-steps`, never from browser code). While a request runs, its D1, R2, KV
 * and service-binding calls and its fetches are counted with their time; the "slow request" log line carries
 * the summary. Two counters per call, nothing is logged or kept for a request that was fast. Names of bindings
 * and templated paths only: no keys, SQL, ids or bodies.
 *
 *   waitMs   time with at least one call in flight; what is left of durationMs is the Worker's own work
 *   steps    per kind: calls × total (longest), the slowest kinds first. Totals overlap when calls run at once
 *   cold     the first request of this isolate; ageMs: how long ago that one was
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { normalizeRoute } from './error-reporting/fingerprint';

interface Step {
	n: number;
	ms: number;
	max: number;
}

interface Run {
	cold: boolean;
	startedAt: number;
	steps: Map<string, Step>;
	inFlight: number;
	busySince: number;
	waitMs: number;
}

export interface StepSummary {
	cold: boolean;
	ageMs: number;
	waitMs: number;
	steps: string;
}

const als = new AsyncLocalStorage<Run>();
let firstRequestAt = 0;

/** Kinds kept per request, and named in its line. */
const MAX_KINDS = 40;
const MAX_NAMED = 6;

/** Runs a request with its own counters (an outer run wins: one request, one line). */
export function runWithSteps<T>(fn: () => T): T {
	if (als.getStore()) return fn();
	const now = Date.now();
	const cold = firstRequestAt === 0;
	if (cold) firstRequestAt = now;
	installFetchSteps();
	return als.run({ cold, startedAt: now, steps: new Map(), inFlight: 0, busySince: 0, waitMs: 0 }, fn);
}

/** Times one call. Never changes its result. */
export function timeStep<T>(kind: string, call: () => T): T {
	const run = als.getStore();
	if (!run) return call();
	const started = Date.now();
	if (run.inFlight++ === 0) run.busySince = started;
	const done = () => {
		const now = Date.now();
		if (--run.inFlight === 0) run.waitMs += now - run.busySince;
		const name = run.steps.has(kind) || run.steps.size < MAX_KINDS ? kind : 'other';
		const step = run.steps.get(name) ?? { n: 0, ms: 0, max: 0 };
		step.n++;
		step.ms += now - started;
		step.max = Math.max(step.max, now - started);
		run.steps.set(name, step);
	};
	let result: T;
	try {
		result = call();
	} catch (error) {
		done();
		throw error;
	}
	if (typeof (result as { then?: unknown } | null)?.then !== 'function') {
		done();
		return result;
	}
	return (result as unknown as Promise<unknown>).then(
		(value) => {
			done();
			return value;
		},
		(error: unknown) => {
			done();
			throw error;
		},
	) as T;
}

/** The current request's steps so far; undefined outside a run. */
export function stepSummary(): StepSummary | undefined {
	const run = als.getStore();
	if (!run) return undefined;
	const now = Date.now();
	const named = [...run.steps].sort((a, b) => b[1].ms - a[1].ms).slice(0, MAX_NAMED);
	return {
		cold: run.cold,
		ageMs: run.startedAt - firstRequestAt,
		waitMs: run.waitMs + (run.inFlight > 0 ? now - run.busySince : 0),
		steps: named.map(([kind, s]) => `${kind} ${s.n}x ${s.ms}ms${s.n > 1 ? ` (max ${s.max})` : ''}`).join(', '),
	};
}

const METHODS: Record<string, readonly string[]> = {
	R2Bucket: ['get', 'head', 'put', 'delete', 'list'],
	KvNamespace: ['get', 'getWithMetadata', 'put', 'delete', 'list'],
	Fetcher: ['fetch'],
};
const LABEL: Record<string, string> = { R2Bucket: 'r2', KvNamespace: 'kv', Fetcher: 'service', D1Database: 'd1' };

/** The native statement behind a timed one: D1's batch takes only its own. */
const nativeStatements = new WeakMap<object, object>();

type AnyObject = Record<PropertyKey, any>;

function timedStatement(target: AnyObject, kind: string): AnyObject {
	const proxy: AnyObject = new Proxy(target, {
		get(t, prop) {
			if (prop === 'bind') return (...args: unknown[]) => timedStatement(t.bind(...args), kind);
			if (prop === 'first' || prop === 'all' || prop === 'run' || prop === 'raw') return (...args: unknown[]) => timeStep(kind, () => t[prop](...args));
			const value = Reflect.get(t, prop, t);
			return typeof value === 'function' ? value.bind(t) : value;
		},
	});
	nativeStatements.set(proxy, target);
	return proxy;
}

function timedD1(target: AnyObject, kind: string): AnyObject {
	return new Proxy(target, {
		get(t, prop) {
			if (prop === 'prepare') return (sql: string) => timedStatement(t.prepare(sql), kind);
			if (prop === 'batch') return (statements: object[]) => timeStep(kind, () => t.batch(statements.map((s) => nativeStatements.get(s) ?? s)));
			if (prop === 'exec') return (sql: string) => timeStep(kind, () => t.exec(sql));
			if (prop === 'withSession') return (...args: unknown[]) => timedD1(t.withSession(...args), kind);
			const value = Reflect.get(t, prop, t);
			return typeof value === 'function' ? value.bind(t) : value;
		},
	});
}

function timedMethods(target: AnyObject, kind: string, methods: readonly string[], rpc: boolean): AnyObject {
	return new Proxy(target, {
		get(t, prop) {
			const value = Reflect.get(t, prop, t);
			if (typeof value !== 'function') return value;
			if (methods.includes(prop as string)) return (...args: unknown[]) => timeStep(kind, () => Reflect.apply(value, t, args));
			// A service binding answers any name with an RPC method: handed on untouched
			return rpc ? value : value.bind(t);
		},
	});
}

/** One wrapper per binding, so a cache keyed by a binding keeps working. */
const timed = new WeakMap<object, AnyObject>();

function timedBinding(name: string, binding: AnyObject): AnyObject {
	const known = timed.get(binding);
	if (known) return known;
	const type = (Object.getPrototypeOf(binding) as { constructor?: { name?: string } } | null)?.constructor?.name ?? '';
	if (type !== 'D1Database' && !METHODS[type]) return binding;
	const wrapper = type === 'D1Database' ? timedD1(binding, `d1:${name}`) : timedMethods(binding, `${LABEL[type]}:${name}`, METHODS[type], type === 'Fetcher');
	timed.set(binding, wrapper);
	return wrapper;
}

const timedEnvs = new WeakMap<object, object>();

/**
 * The same env, each D1, R2, KV and service binding timed. Read through: every name is looked up on the live env
 * when it is asked for, so a binding, switch or value changed later is seen. Bindings are told apart by the
 * runtime's own class; anything else (a limiter, a secret, a queue, a Durable Object, a test's fake) is the env's own.
 */
export function timedBindings<E>(env: E): E {
	if (!env || typeof env !== 'object') return env;
	const known = timedEnvs.get(env);
	if (known) return known as E;
	const proxy = new Proxy(env as AnyObject, {
		get(t, prop) {
			const value = Reflect.get(t, prop, t);
			if (!value || typeof value !== 'object' || typeof prop !== 'string') return value;
			const wrapper = timedBinding(prop, value);
			if (wrapper === value) return value;
			// A locked property must answer its own value
			const own = Reflect.getOwnPropertyDescriptor(t, prop);
			return own && !own.configurable && !own.writable && !own.get ? value : wrapper;
		},
	});
	timedEnvs.set(env, proxy);
	return proxy as E;
}

let fetchInstalled = false;

/** Wraps globalThis.fetch once; a call outside a run is passed on untouched. */
export function installFetchSteps(): void {
	if (fetchInstalled || typeof globalThis.fetch !== 'function') return;
	fetchInstalled = true;
	const original = globalThis.fetch;
	const wrapped = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		if (!als.getStore()) return original.call(this, input, init);
		let target = 'unknown';
		try {
			const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
			target = `${url.host}${normalizeRoute(url.pathname)}`;
		} catch {
			// the call itself says what is wrong with it
		}
		return timeStep(`fetch:${target.slice(0, 80)}`, () => original.call(this, input, init));
	};
	globalThis.fetch = wrapped as typeof fetch;
}

/** Exposed for tests. */
export function resetRequestSteps(): void {
	firstRequestAt = 0;
	fetchInstalled = false;
}
