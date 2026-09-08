declare global {
  interface Window {
    __BLINKO_CONFIG__?: {
      basePath?: string;
    };
  }
}

function normalizeBasePath(path: string): string {
  if (!path || path === '/') return '';
  return `/${path.replace(/^\/+|\/+$/g, '')}`;
}

const configuredBasePath = window.__BLINKO_CONFIG__?.basePath
  || document.querySelector('base')?.getAttribute('href')
  || '';

export const basePath = normalizeBasePath(configuredBasePath);

export function withBasePath(path: string): string {
  // CUSTOM-JOURNAL: an empty path means "the base URL itself" (e.g. getBlinkoEndpoint('')
  // uses this to build vditor's CDN root, which it then appends /dist/js/... to) - '' fails
  // the startsWith('/') check below and used to be returned unchanged, silently dropping
  // the base path prefix and breaking every vditor-fetched asset (lute.min.js,
  // highlight.js themes, mermaid, katex, ...) under a subpath deployment.
  if (path === '') return basePath || '/';
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) return path;
  return `${basePath}${path}` || '/';
}

export function stripBasePath(path: string): string {
  if (!basePath || path === basePath) return '/';
  if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length) || '/';
  return path;
}