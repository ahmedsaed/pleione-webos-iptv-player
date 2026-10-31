import { CONFIG } from '../config';

// The LAN service binds to an OS-assigned port at startup and reports it
// through the Luna `start` response (see app.ts → startBundledService). Until
// setServicePort() receives that value, serviceBase() returns null and both LAN
// clients behave as if the service were unreachable. This also covers dev and
// e2e environments where Luna is unavailable and no service runs.
let runtimePort: number | null = null;
// Proves to the service that a request comes from this app and not from a
// web page on the TV; it arrives only over Luna, with the port.
let runtimeKey: string | null = null;

export function setServicePort(port: number | null, key: string | null = null): void {
  if (port === null) {
    runtimePort = null;
    runtimeKey = null;
    return;
  }
  if (typeof port === 'number' && port > 0 && port < 65536) {
    runtimePort = port;
    runtimeKey = typeof key === 'string' && key ? key : null;
  }
}

export function serviceBase(): string | null {
  if (runtimePort === null) return null;
  return `http://${CONFIG.SERVICE_HOST}:${runtimePort}`;
}

// A service URL for `path`, carrying the app key.
export function serviceUrl(path: string): string | null {
  const base = serviceBase();
  if (!base) return null;
  if (!runtimeKey) return base + path;
  return `${base}${path}${path.indexOf('?') >= 0 ? '&' : '?'}key=${encodeURIComponent(runtimeKey)}`;
}
