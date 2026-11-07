'use client';

/** Library (Story 29.6), RTL (Arabic) entry points. */

import React from 'react';
import { LibraryHubView } from '../LibraryHub';
import { LibraryListPage, type LibraryListKind } from '../LibraryListPage';

export function LibraryHubPageRTL() {
  return <LibraryHubView dir="rtl" />;
}

export function LibraryCollectionPageRTL({ kind }: { kind: LibraryListKind }) {
  return <LibraryListPage kind={kind} dir="rtl" />;
}
