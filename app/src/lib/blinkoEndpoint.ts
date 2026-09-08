
import { withBasePath } from './basePath';
export function getBlinkoEndpoint(path: string = ''): string {
    try {
        const blinkoEndpoint = window.localStorage.getItem('blinkoEndpoint')
        const isTauri = !!(window as any).__TAURI__;
        if (isTauri && blinkoEndpoint) {
            try {
                const url = new URL(withBasePath(path), blinkoEndpoint.replace(/"/g, ''));
                return url.toString();
            } catch (error) {
                console.error(error);
                return new URL(withBasePath(path), window.location.origin).toString();
            }
        }

        return new URL(withBasePath(path), window.location.origin).toString();
    } catch (error) {
        console.error(error);
        return new URL(withBasePath(path), window.location.origin).toString();
    }
}

export function isTauriAndEndpointUndefined(): boolean {
    const isTauri = !!(window as any).__TAURI__;
    const blinkoEndpoint = window.localStorage.getItem('blinkoEndpoint')
    return isTauri && !blinkoEndpoint;
}

export function saveBlinkoEndpoint(endpoint: string): void {
    if (endpoint) {
        window.localStorage.setItem('blinkoEndpoint', endpoint);
    }
}

export function getSavedEndpoint(): string {
    return window.localStorage.getItem('blinkoEndpoint') || '';
}
