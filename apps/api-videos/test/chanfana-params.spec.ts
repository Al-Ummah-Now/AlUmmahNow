import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { Bool, DateTime, Enumeration, Int, Num, Str } from '../src/lib/chanfana-params';

/** chanfana 2's parameter helpers, kept on zod 4 with the same behaviour (lib/chanfana-params.ts). */
describe('chanfana-params', () => {
	it('fields are required unless required: false', () => {
		const s = z.object({ a: Str(), b: Str({ required: false }), n: Num({ required: false }), f: Bool({ required: false }) });
		assert.equal(s.safeParse({}).success, false);
		assert.deepEqual(s.parse({ a: 'x' }), { a: 'x' });
	});

	it('applies a truthy default, and description and example reach the OpenAPI document', () => {
		const limit = Num({ description: 'How many', default: 10 });
		assert.equal(z.object({ limit }).parse({}).limit, 10);
		const registry = new OpenAPIRegistry();
		registry.register('X', z.object({ limit, q: Str({ description: 'Search', example: 'abc', required: false }) }));
		const x = new OpenApiGeneratorV31(registry.definitions).generateComponents().components?.schemas?.X as any;
		assert.deepEqual(x.properties.limit, { type: 'number', description: 'How many' });
		assert.deepEqual(x.properties.q, { type: 'string', description: 'Search', example: 'abc' });
		assert.equal(x.required, undefined);
	});

	it('Int rejects fractions, Num accepts them', () => {
		assert.equal(Int().safeParse(1.5).success, false);
		assert.equal(Num().safeParse(1.5).success, true);
	});

	it('DateTime takes ISO 8601 UTC timestamps only', () => {
		assert.equal(DateTime().safeParse('2026-11-21T10:00:00Z').success, true);
		assert.equal(DateTime().safeParse('2026-11-21T10:00:00.123Z').success, true);
		const bad = DateTime().safeParse('21/11/2026');
		assert.equal(bad.success, false);
		assert.match(bad.error!.issues[0].message, /YYYY-mm-ddTHH:MM:ssZ/);
	});

	it('Enumeration maps values and can ignore case', () => {
		const exact = Enumeration({ values: ['srt', 'vtt'] });
		assert.equal(exact.parse('vtt'), 'vtt');
		assert.equal(exact.safeParse('VTT').success, false);
		const loose = Enumeration({ values: { SRT: 'srt', VTT: 'vtt' }, enumCaseSensitive: false });
		assert.equal(loose.parse('Vtt'), 'vtt');
		assert.deepEqual((loose as unknown as { values: unknown }).values, { SRT: 'srt', VTT: 'vtt' });
	});
});
