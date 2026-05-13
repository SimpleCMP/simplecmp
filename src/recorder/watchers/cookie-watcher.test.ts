import { describe, expect, it } from 'vitest';
import type { RawDetection } from '../types.js';
import { CookieWatcher } from './cookie-watcher.js';

describe('CookieWatcher', () => {
  it('reports each unique cookie exactly once on initial scan', () => {
    const seen: RawDetection[] = [];
    const watcher = new CookieWatcher((d) => seen.push(d), {
      readCookies: () => '_ga=foo; _gid=bar; sessionid=abc',
    });

    watcher.start();
    watcher.stop();

    expect(seen.map((d) => d.identifier).sort()).toEqual(['_ga', '_gid', 'sessionid']);
    for (const d of seen) expect(d.kind).toBe('cookie');
  });

  it('does not re-report cookies that were already seen', () => {
    let cookieStr = '_ga=foo';
    const seen: RawDetection[] = [];
    const watcher = new CookieWatcher((d) => seen.push(d), {
      readCookies: () => cookieStr,
    });

    watcher.start(); // scan #1: _ga
    watcher.scanOnce(); // scan #2: still _ga, no new emission
    expect(seen.length).toBe(1);

    cookieStr = '_ga=foo; _hjid=xyz';
    watcher.scanOnce(); // scan #3: new _hjid
    expect(seen.length).toBe(2);
    expect(seen[1]?.identifier).toBe('_hjid');

    watcher.stop();
  });

  it('handles empty cookie string', () => {
    const seen: RawDetection[] = [];
    const watcher = new CookieWatcher((d) => seen.push(d), { readCookies: () => '' });
    watcher.start();
    watcher.stop();
    expect(seen).toEqual([]);
  });

  it('strips leading whitespace and ignores entries without a name', () => {
    const seen: RawDetection[] = [];
    const watcher = new CookieWatcher((d) => seen.push(d), {
      readCookies: () => ' a=1;  b=2;=missing-name; c=3',
    });
    watcher.start();
    watcher.stop();
    expect(seen.map((d) => d.identifier).sort()).toEqual(['a', 'b', 'c']);
  });
});
