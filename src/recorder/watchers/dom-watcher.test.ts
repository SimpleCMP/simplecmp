import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RawDetection } from '../types.js';
import { DomWatcher } from './dom-watcher.js';

describe('DomWatcher', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('reports cross-origin <script> tags inserted after start()', async () => {
    const seen: RawDetection[] = [];
    const watcher = new DomWatcher((d) => seen.push(d));
    watcher.start();

    const script = document.createElement('script');
    script.src = 'https://www.google-analytics.com/ga.js';
    document.body.appendChild(script);

    // MutationObserver fires asynchronously
    await new Promise((resolve) => setTimeout(resolve, 0));
    watcher.stop();

    expect(seen.length).toBe(1);
    expect(seen[0]?.kind).toBe('script');
    expect(seen[0]?.identifier).toBe('https://www.google-analytics.com/ga.js');
    expect(seen[0]?.origin).toBe('www.google-analytics.com');
  });

  it('reports <iframe> and <img> tags too', async () => {
    const seen: RawDetection[] = [];
    const watcher = new DomWatcher((d) => seen.push(d));
    watcher.start();

    const iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube.com/embed/x';
    document.body.appendChild(iframe);

    const img = document.createElement('img');
    img.src = 'https://pixel.example.com/p.gif';
    document.body.appendChild(img);

    await new Promise((resolve) => setTimeout(resolve, 0));
    watcher.stop();

    const kinds = seen.map((d) => d.kind).sort();
    expect(kinds).toEqual(['iframe', 'image']);
  });

  it('catches statically-rendered tags via the initial scan', () => {
    const script = document.createElement('script');
    script.src = 'https://example-cdn.com/lib.js';
    document.body.appendChild(script);

    const seen: RawDetection[] = [];
    const watcher = new DomWatcher((d) => seen.push(d));
    watcher.start();
    watcher.stop();

    expect(seen.length).toBe(1);
    expect(seen[0]?.identifier).toBe('https://example-cdn.com/lib.js');
  });

  it('ignores same-origin resources', async () => {
    const seen: RawDetection[] = [];
    const watcher = new DomWatcher((d) => seen.push(d));
    watcher.start();

    const script = document.createElement('script');
    script.src = `${location.origin}/local.js`;
    document.body.appendChild(script);

    await new Promise((resolve) => setTimeout(resolve, 0));
    watcher.stop();

    expect(seen).toEqual([]);
  });

  it('does not double-report the same URL', async () => {
    const seen: RawDetection[] = [];
    const watcher = new DomWatcher((d) => seen.push(d));
    watcher.start();

    for (let i = 0; i < 3; i++) {
      const s = document.createElement('script');
      s.src = 'https://repeat.example.com/x.js';
      document.body.appendChild(s);
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
    watcher.stop();

    expect(seen.length).toBe(1);
  });
});
