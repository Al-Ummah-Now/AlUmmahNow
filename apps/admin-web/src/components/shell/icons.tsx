/**
 * The admin's icons: 24px outline paths drawn in currentColor, so they take the
 * theme's colour from the element they sit in. Decorative: every icon is
 * aria-hidden and the control around it carries the label.
 */
const PATHS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  spark: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  chat: 'M4 5h16v11H9l-5 4z',
  people: 'M3 19c0-3 3-5 6-5s6 2 6 5M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M17 11a3 3 0 1 0 0-6M21 19c0-2.4-1.6-4.2-4-4.8',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  film: 'M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16',
  tv: 'M3 6h18v12H3zM8 21h8M12 3l-3 3m3-3l3 3',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  user: 'M4 20c0-4 4-6 8-6s8 2 8 6M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5z',
  key: 'M15 8a4 4 0 1 1-3.5 6L4 21H3v-3l7-7A4 4 0 0 1 15 8zM16 7h.01',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  cpu: 'M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  alert: 'M12 3l10 18H2zM12 10v4M12 17h.01',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  file: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13l2 2 4-4',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.6-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 21 9.7C21 5.9 17 3 12 3zM7.5 12.5h.01M9.5 7.5h.01M14.5 7.5h.01',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  chevron: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  sidebar: 'M3 4h18v16H3zM9 4v16',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  enter: 'M20 5v7a3 3 0 0 1-3 3H5m0 0l4-4m-4 4l4 4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'size-[18px]' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 fill-none stroke-current ${className}`}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
