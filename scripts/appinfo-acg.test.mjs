import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// webOS TV 27+ rejects an app whose Luna calls (its own or its bundled
// service's) lack an ACG group in appinfo.json's requiredACG.
const ACG_BY_SERVICE = {
  'com.webos.service.activitymanager': 'activity.operation',
  'com.palm.activitymanager': 'activity.operation',
  'com.webos.applicationManager': 'application.launcher',
  'com.webos.service.drm': 'drm.query',
};
// LG's ACG table maps no group to these; the app's own service needs none.
const UNGROUPED = new Set(['com.webos.notification', 'com.webos.media']);

function lunaServices() {
  const out = execFileSync('git', [
    'grep', '-hoE', 'luna://[A-Za-z0-9._]+', '--', 'src', 'bundled-service/src',
    ':!*.test.ts', ':!*.test.mjs',
  ], { encoding: 'utf8' });
  return [...new Set(out.split('\n').filter(Boolean).map((s) => s.slice('luna://'.length)))]
    .filter((s) => s !== '...' && !s.startsWith('$'));
}

describe('appinfo requiredACG', () => {
  const appinfo = JSON.parse(readFileSync('appinfo.json', 'utf8'));

  it('declares a group for every Luna service the app calls', () => {
    const services = lunaServices();
    expect(services.length).toBeGreaterThan(0);
    for (const service of services) {
      if (UNGROUPED.has(service)) continue;
      expect(ACG_BY_SERVICE, `no ACG mapping for ${service}`).toHaveProperty([service]);
      expect(appinfo.requiredACG).toContain(ACG_BY_SERVICE[service]);
    }
  });

  it('declares no group the app does not use', () => {
    const used = new Set(lunaServices().map((s) => ACG_BY_SERVICE[s]).filter(Boolean));
    expect([...appinfo.requiredACG].sort()).toEqual([...used].sort());
  });
});
