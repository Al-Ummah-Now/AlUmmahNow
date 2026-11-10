'use client';
// Browser calls for the theme builder. They go to this app's /api/themes proxy, which adds the
// session's admin API token on the server.
import { duplicatePackage, packageToZip, zipToPackage, type Issue, type Localized, type PackageFiles, type ThemePackage, type Validation } from '@al-ummah/theme-packages';

export class ThemeApiError extends Error {
  constructor(readonly status: number, message: string, readonly issues: Issue[] = []) { super(message); }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/themes${path}`, { cache: 'no-store', ...init });
  const body = (await response.json().catch(() => ({}))) as { success?: boolean; result?: T; error?: string; issues?: Issue[] };
  if (!response.ok || body.success === false) throw new ThemeApiError(response.status, body.error ?? `HTTP ${response.status}`, body.issues ?? []);
  return body.result as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

export const saveDraft = (id: string, theme: ThemePackage) => call<{ validation: Validation }>(`/${id}/draft`, { method: 'PUT', ...json(theme) });
export const publish = (id: string) => call<{ version: string; validation: Validation }>(`/${id}/publish`, { method: 'POST' });
/** Soft delete (restorable for 30 days in Recently deleted). */
export const removeTheme = (id: string, reason = '') => call<void>(`/${id}`, { method: 'DELETE', ...json({ reason }) });
export const importZip = (zip: Uint8Array, rename?: string) =>
  call<{ id: string; validation: Validation }>(`/import${rename ? `?id=${encodeURIComponent(rename)}` : ''}`, { method: 'POST', body: zip as BodyInit, headers: { 'Content-Type': 'application/zip' } });
export const uploadAsset = (id: string, path: string, file: Blob) =>
  call<{ path: string; size: number }>(`/${id}/draft/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
export const deleteAsset = (id: string, path: string) => call<void>(`/${id}/draft/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' });

/** Where the preview reads a draft's file. */
export const draftAssetUrl = (id: string) => (path: string) => `/api/themes/${id}/draft/${path.split('/').map(encodeURIComponent).join('/')}`;
export const builtInAssetUrl = (id: string) => (path: string) => `/theme-kit/builtins/${id}/${path}`;
export const exportUrl = (id: string, version = 'draft') => `/api/themes/${id}/export?version=${encodeURIComponent(version)}`;

/** A built-in package from the theme kit this app ships. */
export async function loadBuiltIn(id: string): Promise<PackageFiles> {
  const index = (await (await fetch('/theme-kit/builtins/index.json')).json()) as { themes: { id: string; files: string[] }[] };
  const entry = index.themes.find((t) => t.id === id);
  if (!entry) throw new ThemeApiError(404, `No built-in theme ${id}`);
  const theme = (await (await fetch(`/theme-kit/builtins/${id}/theme.json`)).json()) as ThemePackage;
  const assets: Record<string, Uint8Array> = {};
  await Promise.all(entry.files.map(async (path) => { assets[path] = new Uint8Array(await (await fetch(builtInAssetUrl(id)(path))).arrayBuffer()); }));
  return { theme, assets };
}

/** Duplicates a built-in, or a custom theme's latest published version (else its draft), under a new id. */
export async function duplicate(source: { id: string; builtIn: boolean; latestVersion: string | null }, id: string, name: Localized, author: string) {
  const files = source.builtIn
    ? await loadBuiltIn(source.id)
    : await zipToPackage(new Uint8Array(await (await fetch(exportUrl(source.id, source.latestVersion ?? 'draft'))).arrayBuffer()));
  const theme = duplicatePackage(files.theme, id, name, author);
  return importZip(packageToZip({ theme, assets: files.assets }));
}
