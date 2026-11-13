import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatRumReport, rumSql } from '../rum-report.ts';

describe('rum report', () => {
	it('queries the environment dataset with a bounded window', () => {
		assert.match(rumSql('production', 7), /FROM al_ummah_now_rum WHERE timestamp > NOW\(\) - INTERVAL '7' DAY/);
		assert.match(rumSql('qa', 1000), /FROM al_ummah_now_rum_qa .*INTERVAL '90' DAY/);
		assert.match(rumSql('stage', 7), /quantileExactWeighted\(0\.75\)\(double1, _sample_interval\)/);
	});
	it('rates p75s against the Core Web Vitals thresholds', () => {
		const out = formatRumReport('production', 7, [
			{ metric: 'LCP', kind: 'watch', device: 'phone', locale: 'ar', p75: 2100, samples: 40 },
			{ metric: 'CLS', kind: 'home', device: 'phone', locale: 'en', p75: 0.3, samples: 20 },
			{ metric: 'INP', kind: 'channel', device: 'desktop', locale: 'en', p75: 350, samples: 5 },
		]);
		assert.match(out, /\| LCP \| watch \| phone \| ar \| 2100 ms \| good \| 40 \|/);
		assert.match(out, /\| CLS \| home \| phone \| en \| 0\.300 \| poor \| 20 \|/);
		assert.match(out, /\| INP \| channel \| desktop \| en \| 350 ms \| needs improvement \| 5 \|/);
		assert.match(formatRumReport('qa', 7, []), /no data/);
	});
});
