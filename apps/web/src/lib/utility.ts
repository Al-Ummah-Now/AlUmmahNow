"use client";
export function assertIsNode(e: EventTarget | null): asserts e is Node {
  if (!e || !("nodeType" in e)) {
    throw new Error(`Node expected`);
  }
}

export type ObservableListner<T> = (target: T) => void;

export class Observable<T> {
  listeners: Array<ObservableListner<T>> = []; // initial listeners can be passed an an argument aswell
  value: T;

  constructor(target: T) {
    this.value = target;
  }

  public get() {
    return this.value;
  }

  public set(newValue: T) {
    if (this.value === newValue) return;
    this.value = newValue;
    this.listeners.forEach((l) => l(this.value));
  }

  public subscribe(listenerFunc: ObservableListner<T>) {
    this.listeners.push(listenerFunc);
    return () => this.unsubscribe(listenerFunc); // will be used inside React.useEffect
  }

  public unsubscribe(listenerFunc: ObservableListner<T>) {
    this.listeners = this.listeners.filter((l) => l !== listenerFunc);
  }
}

export function resolveUrl(url: string, baseUrl?: string): string {
  // Handle data URIs (base64 encoded images)
  if (url.startsWith("data:")) {
    return url; // Data URIs should be returned as-is
  }

  // Use the provided baseUrl or fallback to window.location.origin in the browser
  const resolvedBaseUrl = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");

  if (url.startsWith("http")) {
    return url; // Fully qualified URL
  } else if (url.startsWith("/")) {
    return `${resolvedBaseUrl}${url}`; // Relative URL
  } else {
    return `https://${url}`; // Domain or subdomain
  }
}

export function removeUnwantedChars(str: string): string {
  // remove extension from the string
  str = str.replace(/\.[^/.]+$/, "");
  return str.replace(/⧸/g, ".");
}

/**
 * Create API headers from user information
 * Note: userId is now extracted from JWT token in Authorization header server-side
 * @param channelId - Optional channelId to include in headers
 * @returns API headers object or undefined if no channelId
 */
export function createApiHeaders(channelId?: string): { channelId: string } | undefined {
  if (!channelId) return undefined;
  return { channelId };
}

/**
 * Arabic pluralization for time units
 * In Arabic, word forms change based on the number:
 * - 1: singular form
 * - 2: dual form
 * - 3-10: plural form
 * - 11+: singular form with number
 *
 * @param count - The number to pluralize
 * @param singular - Singular form (e.g., "ساعة")
 * @param dual - Dual form (e.g., "ساعتان")
 * @param plural - Plural form (e.g., "ساعات")
 * @returns Properly pluralized Arabic text
 */
export function pluralizeArabic(count: number, singular: string, dual: string, plural: string): string {
  if (count === 1) {
    return `${count} ${singular}`;
  } else if (count === 2) {
    return dual;
  } else if (count >= 3 && count <= 10) {
    return `${count} ${plural}`;
  } else {
    return `${count} ${singular}`;
  }
}