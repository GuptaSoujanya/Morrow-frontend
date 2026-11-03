import { test, expect } from '@playwright/test';

test('seven app tabs release hidden streams and keep the course responsive', async ({ context }) => {
  test.setTimeout(60000);
  const pages = [], errors = [], writes = [], failed = [];
  await context.route('**/*', route => {
    const request = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writes.push(new URL(request.url()).pathname);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  try {
    for (let index = 0; index < 7; index++) {
      const page = await context.newPage(); pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      page.on('requestfailed', request => {
        if (!new URL(request.url()).pathname.startsWith('/api/events')) failed.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText });
      });
      await page.addInitScript(hidden => {
        window.qaNativeVisibility = { hidden: document.hidden, state: document.visibilityState };
        window.qaHidden = hidden;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.qaHidden });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.qaHidden ? 'hidden' : 'visible' });
        const OriginalEventSource = window.EventSource;
        window.qaStreams = { created: 0, closed: 0, active: 0 };
        window.EventSource = class extends OriginalEventSource {
          constructor(...args) { super(...args); this.qaClosed = false; window.qaStreams.created++; window.qaStreams.active++; }
          close() {
            if (!this.qaClosed) { this.qaClosed = true; window.qaStreams.closed++; window.qaStreams.active--; }
            return super.close();
          }
        };
      }, index < 6);
      const started = Date.now();
      await page.goto('http://127.0.0.1:8100/#/learning/plan', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.course-reading')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.daily-content .state-error')).toHaveCount(0);
      console.log(JSON.stringify({ event: 'course-open', tab: index + 1, milliseconds: Date.now() - started,
        ...await page.evaluate(() => ({ nativeVisibility: window.qaNativeVisibility, simulatedHidden: document.hidden, streams: window.qaStreams })) }));
    }
    const streamCounts = () => Promise.all(pages.map(page => page.evaluate(() => window.qaStreams.active)));
    await expect.poll(streamCounts).toEqual([0, 0, 0, 0, 0, 0, 1]);
    const fetchDaily = page => page.evaluate(async () => {
      const started = performance.now();
      const response = await fetch('/api/learning/daily', { signal: AbortSignal.timeout(20000), cache: 'no-store' });
      await response.text();
      return { status: response.status, milliseconds: Math.round(performance.now() - started) };
    });
    const result = await fetchDaily(pages[6]);
    console.log(JSON.stringify({ event: 'seven-app-tabs-course-fetch', ...result }));
    expect(result.status).toBe(200); expect(result.milliseconds).toBeLessThan(5000);
    await pages[6].evaluate(() => { window.qaHidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await pages[0].evaluate(() => { window.qaHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(streamCounts).toEqual([1, 0, 0, 0, 0, 0, 0]);
    await expect(pages[0].locator('.course-reading')).toBeVisible();
    const switched = await fetchDaily(pages[0]);
    console.log(JSON.stringify({ event: 'switched-visible-tab-course-fetch', ...switched, streamCounts: await streamCounts() }));
    expect(switched.status).toBe(200); expect(switched.milliseconds).toBeLessThan(5000);
    await pages[0].screenshot({ path: 'artifacts/course-live-error/seven-tabs-fixed.png', fullPage: false });
    for (const page of pages) await expect(page.getByText('The server is taking too long. Try again.', { exact: true })).toHaveCount(0);
    console.log(JSON.stringify({ event: 'final-diagnostics', errors, failed, writes }));
    expect(errors).toEqual([]); expect(writes).toEqual([]); expect(failed).toEqual([]);
  } finally { await Promise.all(pages.map(page => page.close().catch(() => {}))); }
});

// Manual read-only diagnostic. These raw streams intentionally have no app
// visibility lifecycle; use them only to demonstrate the browser socket limit.
test('six raw streams reproduce the course timeout and releasing one recovers', async ({ context }) => {
  test.setTimeout(60000);
  const pages = [];
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.abort('blockedbyclient');
    if (url.pathname === '/__qa_stream_probe') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Read-only stream probe</title>' });
    return route.continue();
  });
  try {
    for (let index = 0; index < 6; index++) {
      const page = await context.newPage(); pages.push(page);
      await page.goto('http://127.0.0.1:8100/__qa_stream_probe');
      const result = await page.evaluate(() => new Promise(resolve => {
        window.qaStream = new EventSource('/api/events?after=0', { withCredentials: true });
        const timeout = setTimeout(() => resolve('open-timeout'), 3000);
        window.qaStream.onopen = () => { clearTimeout(timeout); resolve('open'); };
        window.qaStream.onerror = () => { clearTimeout(timeout); resolve('error'); };
      }));
      console.log(JSON.stringify({ event: 'stream', index: index + 1, result }));
    }
    const probe = await context.newPage(); pages.push(probe);
    await probe.goto('http://127.0.0.1:8100/__qa_stream_probe');
    const requestCourse = () => probe.evaluate(async () => {
      const started = performance.now();
      try {
        const reply = await fetch('/api/learning/daily', { signal: AbortSignal.timeout(20000), cache: 'no-store' });
        await reply.text(); return { status: reply.status, milliseconds: Math.round(performance.now() - started) };
      } catch (error) { return { error: error.name, message: error.message, milliseconds: Math.round(performance.now() - started) }; }
    });
    console.log(JSON.stringify({ phase: 'six-open-streams', ...await requestCourse() }));
    await pages[0].evaluate(() => window.qaStream.close());
    console.log(JSON.stringify({ phase: 'one-stream-released', ...await requestCourse() }));
  } finally { await Promise.all(pages.map(page => page.close().catch(() => {}))); }
});
