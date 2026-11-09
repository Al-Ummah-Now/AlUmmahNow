// Prototype only: lets the watch page tell the player what plays next.
export interface DemoNext { title: string; channel: string; thumb?: string; href: string }
let current: DemoNext | null = null;
const subs = new Set<() => void>();
export const getDemoNext = () => current;
export function setDemoNext(n: DemoNext | null) { current = n; subs.forEach((f) => f()); }
export function subscribeDemoNext(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
