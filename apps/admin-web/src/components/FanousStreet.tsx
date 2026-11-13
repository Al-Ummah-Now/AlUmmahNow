'use client';

import { useEffect } from 'react';
// The shared lantern street module (one file for every app; other repos vendor it)
import { startStreet } from '../../../../packages/fanous-tokens/street/fanous-street.js';

/** The site theme's lantern street (Fawanees): draws only when the active theme switches it on. */
export function FanousStreet() {
  useEffect(() => startStreet(), []);
  return null;
}
