/**
 * Workers AI list prices converted to neurons ($0.011 per 1,000 neurons).
 * Source: https://developers.cloudflare.com/workers-ai/platform/pricing/ (checked 2026-11-08).
 */

export const USD_PER_NEURON = 0.011 / 1000;

export const MODELS = {
  translate: '@cf/meta/m2m100-1.2b',
  guard: '@cf/meta/llama-guard-3-8b',
  extensions: '@cf/meta/llama-4-scout-17b-16e-instruct',
} as const;

/** Neurons per million tokens: [input, output]. */
const NEURONS_PER_M: Record<string, [number, number]> = {
  '@cf/meta/m2m100-1.2b': [31050, 31050],
  '@cf/meta/llama-guard-3-8b': [44003, 2730],
  '@cf/meta/llama-4-scout-17b-16e-instruct': [24545, 77273],
  '@cf/mistralai/mistral-small-3.1-24b-instruct': [31876, 50488],
  // Pre-publication review (docs/specs/VIDEO-REVIEW.md; catalog prices read 2026-11-13)
  '@cf/cloudflare/clef-flash': [3455, 0], // $0.038 / M input
  '@cf/google/gemma-4-26b-a4b-it': [9091, 27273], // $0.10 / $0.30 per M
  // Speech to text is priced per audio minute ($0.000513); usage counts seconds as "input tokens"
  '@cf/openai/whisper-large-v3-turbo': [777273, 0],
};

/** Unknown models are priced like the most expensive known input/output rates (never under-count). */
const FALLBACK: [number, number] = [44003, 77273];

export function neuronsFor(model: string, inputTokens: number, outputTokens: number): number {
  const [inRate, outRate] = NEURONS_PER_M[model] ?? FALLBACK;
  return (inputTokens * inRate + outputTokens * outRate) / 1_000_000;
}

export function usdFor(neurons: number): number {
  return neurons * USD_PER_NEURON;
}
