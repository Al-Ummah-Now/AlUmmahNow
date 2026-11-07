/**
 * Regression tests for bugs found by the creator-studio E2E specs (e2e/40-46):
 * upload templates list, batch queue state, dashboard sorting, schedule inputs
 * and 204 responses from the API client.
 */

import { parseTemplateListResponse } from '../upload/template-list';
import { hasActiveUploads } from '../upload/batch-status';
import { compareDashboardVideos } from '../dashboard/sort-videos';
import { isActiveSchedule, toLocalDateInput, toLocalTimeInput } from '@/components/videoEdit/schedule-inputs';
import { apiRequestServer } from '../api/api-client';

jest.mock('@/lib/logger-client', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const template = (id: string, isDefault = false) => ({ id, name: id, isDefault, template: {} }) as never;

describe('parseTemplateListResponse', () => {
  it('unwraps the API envelope (the settings page read response.templates and always showed "No templates")', () => {
    const parsed = parseTemplateListResponse({ success: true, result: { templates: [template('a'), template('b')] } });
    expect(parsed.templates.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('uses defaultTemplateId, or falls back to the template flagged isDefault', () => {
    expect(parseTemplateListResponse({ result: { templates: [template('a')], defaultTemplateId: 'a' } }).defaultTemplateId).toBe('a');
    expect(parseTemplateListResponse({ result: { templates: [template('a'), template('b', true)] } }).defaultTemplateId).toBe('b');
    expect(parseTemplateListResponse({ result: { templates: [template('a')] } }).defaultTemplateId).toBeNull();
  });

  it('accepts an unwrapped list and tolerates empty responses', () => {
    expect(parseTemplateListResponse({ templates: [template('a')] }).templates).toHaveLength(1);
    expect(parseTemplateListResponse(null)).toEqual({ templates: [], defaultTemplateId: null });
    expect(parseTemplateListResponse({ result: {} })).toEqual({ templates: [], defaultTemplateId: null });
  });
});

describe('hasActiveUploads', () => {
  it('is true while anything is pending, uploading or paused', () => {
    expect(hasActiveUploads([{ status: 'completed' }, { status: 'pending' }])).toBe(true);
    expect(hasActiveUploads([{ status: 'uploading' }])).toBe(true);
    expect(hasActiveUploads([{ status: 'paused' }])).toBe(true);
  });

  it('is false once every item finished, failed or was cancelled (batch actions come back)', () => {
    expect(hasActiveUploads([{ status: 'completed' }, { status: 'failed' }, { status: 'cancelled' }])).toBe(false);
    expect(hasActiveUploads([])).toBe(false);
  });
});

describe('compareDashboardVideos', () => {
  const videos = [
    { title: 'Beta', dateCreated: '2026-01-02T00:00:00Z', views: 5 },
    { title: 'alpha', dateCreated: '2026-01-03T00:00:00Z', views: 1 },
    { title: 'Gamma', dateCreated: '2026-01-01T00:00:00Z', views: 9 },
  ];
  const order = (sort: 'date' | 'views' | 'title') => [...videos].sort((a, b) => compareDashboardVideos(a, b, sort)).map((v) => v.title);

  it('sorts by title A-Z (the API has no title sort, so the list stayed in date order)', () => {
    expect(order('title')).toEqual(['alpha', 'Beta', 'Gamma']);
  });

  it('sorts by newest first and by most viewed', () => {
    expect(order('date')).toEqual(['alpha', 'Beta', 'Gamma']);
    expect(order('views')).toEqual(['Gamma', 'Beta', 'alpha']);
  });
});

describe('schedule inputs', () => {
  it('formats the local date and time (toISOString gave the UTC day next to a local time)', () => {
    const date = new Date(2026, 10, 7, 0, 30); // local midnight-ish, the UTC day differs east of UTC
    expect(toLocalDateInput(date)).toBe('2026-11-07');
    expect(toLocalTimeInput(date)).toBe('00:30');
  });
});

describe('isActiveSchedule', () => {
  it('ignores the 200 answer the API gives for unscheduled videos (every private video showed "Scheduled")', () => {
    expect(isActiveSchedule({ isScheduled: false })).toBe(false);
    expect(isActiveSchedule({ isScheduled: true, scheduledPublishDate: 'not a date' })).toBe(false);
    expect(isActiveSchedule({ isScheduled: true, scheduledPublishDate: '2026-11-17T12:00:00.000Z' })).toBe(true);
  });
});

describe('apiRequestServer - 204 No Content', () => {
  it('treats an empty 204 response as success instead of a JSON parse failure', async () => {
    // The shared logger also posts to the log service through fetch, so answer by URL
    global.fetch = jest.fn().mockImplementation(async (url: string) =>
      String(url).includes('/api/upload-defaults/')
        ? {
            ok: true,
            status: 204,
            statusText: 'No Content',
            headers: new Headers(),
            json: async () => {
              throw new SyntaxError('Unexpected end of JSON input');
            },
          }
        : { ok: true, status: 200, statusText: 'OK', headers: new Headers(), json: async () => ({}) },
    );
    const result = await apiRequestServer<{ success: boolean }>(
      { method: 'DELETE', url: 'https://api.example.com/api/upload-defaults/1', functionName: 'deleteTemplate' },
      async () => null,
    );
    expect(result).toEqual({ success: true });
  });
});
