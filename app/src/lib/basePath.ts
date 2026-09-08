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

export const basePath = normalizeBasePath(window.__BLINKO_CONFIG__?.basePath || '');

export function withBasePath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  return `${basePath}${path}` || '/';
}

export function stripBasePath(path: string): string {
  if (!basePath || path === basePath) return '/';
  if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length) || '/';
  return path;
}