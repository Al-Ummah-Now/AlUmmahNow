import { cardDimensions, type CardDesign } from './design';

export interface CardCaptureEnv {
  CARD_RENDER_ACCOUNT?: string;
  CARD_RENDER_TOKEN?: string | { get(): Promise<string> };
}

/** Browser Run's screenshot endpoint uses Chromium's native Arabic shaping and bidi layout. */
export async function captureCard(env: CardCaptureEnv, html: string, format: CardDesign['format']): Promise<ArrayBuffer> {
  const account = env.CARD_RENDER_ACCOUNT;
  const binding = env.CARD_RENDER_TOKEN;
  const token = typeof binding === 'string' ? binding : await binding?.get();
  if (!account || !/^[a-f0-9]{32}$/i.test(account) || !token) {
    throw new Error('Card rendering is unavailable');
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/browser-run/screenshot`, {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html,
      viewport: { ...cardDimensions(format), deviceScaleFactor: 1 },
      screenshotOptions: { type: 'png' },
      waitForSelector: { selector: 'html[data-card-ready="true"]', timeout: 5000 },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/png') {
    await response.body?.cancel();
    throw new Error(`Card image capture failed (HTTP ${response.status})`);
  }
  return response.arrayBuffer();
}
