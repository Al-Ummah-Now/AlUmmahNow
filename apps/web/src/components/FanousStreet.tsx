'use client';

import { useEffect } from 'react';
// The shared lantern street module (one file for every app; other repos vendor it)
import { startStreet } from '../../../../packages/fanous-tokens/street/fanous-street.js';

/**
 * The Fawanees lantern street. Renders nothing: the module draws when the active theme switches
 * the street on (--fanous-street-on: 1) and follows layout, theme and mode changes by itself.
 */
export function FanousStreet() {
  useEffect(() => startStreet(), []);
  return null;
}
