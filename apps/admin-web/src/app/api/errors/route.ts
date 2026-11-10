import { getCloudflareContext } from '@opennextjs/cloudflare';
import { handleErrorReport } from '@/lib/errors/forward';
import { getAdminSession } from '@/lib/auth';

/** Browser error reports → admin-api /internal/errors (src/lib/errors/forward.ts). */
export const dynamic = 'force-dynamic';

type SecretBinding = string | { get(): Promise<string> } | undefined;

export async function POST(req: Request): Promise<Response> {
  let env: Record<string, unknown> = {};
  let waitUntil: (p: Promise<unknown>) => void = () => undefined;
  try {
    const cf = await getCloudflareContext({ async: true });
    env = cf.env as unknown as Record<string, unknown>;
    if (cf.ctx) waitUntil = cf.ctx.waitUntil.bind(cf.ctx);
  } catch {
    // Not running on Workers (next dev): process.env below
  }
  const key = async () => {
    const binding = env.INTERNAL_API_KEY as SecretBinding;
    try {
      if (typeof binding === 'string' && binding) return binding;
      if (binding && typeof binding !== 'string') return (await binding.get()) || '';
    } catch {
      return '';
    }
    return process.env.INTERNAL_API_KEY || '';
  };
  return handleErrorReport(req, {
    key,
    adminApiUrl: () => process.env.ADMIN_API_URL,
    waitUntil,
    fetch: (...args) => fetch(...args),
    userId: async () => (await getAdminSession())?.user.id ?? null,
  });
}
