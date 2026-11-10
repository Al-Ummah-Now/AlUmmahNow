/**
 * Bounds of request-path bucket scans (docs/architecture/SCALABILITY-AUDIT.md, AV-16).
 *
 * Endpoints answer from D1 (the search and ownership indexes). A bucket scan
 * runs only as a fallback while an index is unavailable or incomplete, and
 * reads at most this many objects (one list per 100 keys plus one get per
 * object), so a request stays far below the Workers subrequest limit and its
 * cost does not grow with the catalogue. A fallback may then answer from part
 * of the bucket; the index self-heal and the daily reconcile complete the index.
 */
export const FALLBACK_SCAN_OBJECTS = 300;
