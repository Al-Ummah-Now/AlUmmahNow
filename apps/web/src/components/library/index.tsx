'use client';

/**
 * Library (Story 29.6), LTR entry points. RTL variants live in ./rtl.
 * Shared views use logical start/end utilities and take `dir`.
 */

import React from 'react';
import { LibraryHubView } from './LibraryHub';
import { LibraryListPage, type LibraryListKind } from './LibraryListPage';

export function LibraryHubPage() {
  return <LibraryHubView dir="ltr" />;
}

export function LibraryCollectionPage({ kind }: { kind: LibraryListKind }) {
  return <LibraryListPage kind={kind} dir="ltr" />;
}
