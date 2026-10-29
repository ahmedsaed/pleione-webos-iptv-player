import { describe, expect, it } from 'vitest';
import { formatOptions, parseArgs } from './cli-args.mjs';
import { DEMO_SPEC } from './xtream-demo-server.mjs';

describe('xtream-demo-server options', () => {
  it('defaults to a LAN-reachable small catalog with demo credentials', () => {
    const { values } = parseArgs([], DEMO_SPEC);
    expect(values).toMatchObject({ host: '0.0.0.0', size: 'small', username: 'demo', password: 'demo' });
    expect(values.port).toBe(Number(process.env.XTREAM_DEMO_PORT) || 8090);
  });

  it('accepts overrides and rejects an unknown size', () => {
    const { values } = parseArgs(['--port', '0', '--size', 'large', '--username', 'u1'], DEMO_SPEC);
    expect(values).toMatchObject({ port: 0, size: 'large', username: 'u1' });
    expect(() => parseArgs(['--size', 'huge'], DEMO_SPEC)).toThrow('must be one of');
  });

  it('documents every option', () => {
    expect(formatOptions(DEMO_SPEC)).toContain('--prepare');
  });
});
