/**
 * Upload template variables are replaced as plain text: no regex is built from
 * a key (CodeQL js/incomplete-sanitization), and replacement patterns in a
 * value ('$&', '$1', '$$') are inserted as typed.
 */
import type { UploadTemplate } from '@al-ummah/shared-types';
import { processTemplateVariables } from '../template-variables';

function template(title: string, description = ''): UploadTemplate {
  return {
    id: 't1', userId: 'u1', name: 'T', isDefault: false, isActive: true,
    template: { title, description },
    createdAt: '', updatedAt: '', usageCount: 0,
  } as unknown as UploadTemplate;
}

describe('processTemplateVariables', () => {
  it('replaces every occurrence of a variable', () => {
    const out = processTemplateVariables(template('{{series_name}} {{episode}} — {{series_name}}'), { seriesName: 'Seerah', episode: '3' });
    expect(out.title).toBe('Seerah 3 — Seerah');
  });

  it('inserts values with replacement patterns literally', () => {
    const out = processTemplateVariables(template('{{channel_name}}: {{episode}}'), { channelName: 'Noor $& $1 $$', episode: "$` $'" });
    expect(out.title).toBe("Noor $& $1 $$: $` $'");
  });

  it('leaves text without variables and unknown variables alone', () => {
    const out = processTemplateVariables(template('a.b*c {{unknown}} \\d+'), {});
    expect(out.title).toBe('a.b*c {{unknown}} \\d+');
  });
});
