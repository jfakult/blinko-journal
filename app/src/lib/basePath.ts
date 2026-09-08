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
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) return path;
  return `${basePath}${path}` || '/';
}

export function stripBasePath(path: string): string {
  if (!basePath || path === basePath) return '/';
  if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length) || '/';
  return path;
}