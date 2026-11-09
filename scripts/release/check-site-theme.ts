// Release check: the site-theme endpoint answers with a theme that exists, and the site renders it.
// Usage: check-site-theme.ts <admin-api-url> <web-url>
const THEMES = ['lantern', 'zujaj', 'nahas', 'fawanees'];
const [adminApi, web] = process.argv.slice(2);
if (!adminApi || !web) throw new Error('Usage: check-site-theme.ts <admin-api-url> <web-url>');

const response = await fetch(`${adminApi}/public/site-theme`);
if (!response.ok) throw new Error(`/public/site-theme answered ${response.status}; has migration 0006 been applied?`);
const { theme } = (await response.json()) as { theme?: string };
if (!theme || !THEMES.includes(theme)) throw new Error(`Unknown site theme: ${theme}`);

const html = await (await fetch(`${web}/en`)).text();
const rendered = /<html[^>]*data-theme="(\w+)"/.exec(html)?.[1];
if (!rendered) throw new Error('The first HTML has no data-theme');
if (!THEMES.includes(rendered)) throw new Error(`The site renders an unknown theme: ${rendered}`);
console.log(`Site theme ${theme}; the site renders ${rendered} (they can differ for up to a minute after a change).`);
