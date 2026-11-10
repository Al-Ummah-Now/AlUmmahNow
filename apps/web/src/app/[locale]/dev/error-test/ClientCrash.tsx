'use client';

/** Throws while rendering in the browser (after hydration), so the error boundary catches a client error. */
import { useEffect, useState } from 'react';

export function ClientCrash({ marker }: { marker: string }) {
  const [crash, setCrash] = useState(false);
  useEffect(() => setCrash(true), []);
  if (crash) throw new TypeError(`Release error test (client render) ${marker}`);
  return <p data-testid="error-test-loading">…</p>;
}
