'use client';

import React, { useEffect, useRef } from 'react';

interface PhotoFileInputProps {
  id: string;
  label: string;
  onPick: (file: File) => void;
}

/**
 * The hidden file input behind a photo's Change button (the button names it with
 * `data-file-picker`, lib/forms/picker-before-hydration.ts). Lives outside the clickable areas,
 * so its own click does not bubble back into them.
 */
export function PhotoFileInput({ id, label, onPick }: PhotoFileInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const take = () => {
    const input = ref.current;
    const picked = input?.files?.[0];
    if (!input || !picked) return;
    input.value = '';
    onPick(picked);
  };
  const takeRef = useRef(take);
  useEffect(() => {
    takeRef.current = take;
  });
  // Picked before the page hydrated: no change event reached React
  useEffect(() => takeRef.current(), []);
  return <input ref={ref} type="file" id={id} aria-label={label} accept="image/*" className="hidden" onChange={take} />;
}
