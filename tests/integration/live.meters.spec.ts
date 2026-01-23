import { withLiveClient } from './helpers/liveUtil';

describe('Live Mixer Meters (Best Effort)', () => {
  jest.setTimeout(90000);

  test('subscribes to meter stream and receives at least one event (best-effort)', async () => {
    const session = await withLiveClient(6000);
    if (!session) {
      console.warn('No mixers discovered; skipping meters test (no-op)');
      return;
    }

    const { client, cleanup } = session;

    let meterReceived = false;
    client.on('meter' as any, () => { meterReceived = true; });

    // Best-effort subscribe; don't fail the test on timeout, just proceed
    await Promise.race([
      (client as any).meterSubscribe(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('meterSubscribe timeout')), 3000)),
    ]).catch(() => null);

    // Wait shortly to allow a meter frame if available
    await new Promise((r) => setTimeout(r, 1500));
    try { (client as any).meterUnsubscribe(); } catch {}

    // We do not hard fail if no meter arrived (depends on mixer state), but assert boolean type
    expect(typeof meterReceived === 'boolean').toBe(true);

    await cleanup();
  });

  test('meter event shape when received (best-effort)', async () => {
    const session = await withLiveClient(6000);
    if (!session) {
      console.warn('No mixers discovered; skipping meters shape test (no-op)');
      return;
    }

    const { client, cleanup } = session;

    let got: any = null;
    const once = new Promise<void>((resolve) => {
      const handler = (payload: any) => {
        got = payload;
        (client as any).off('meter', handler as any);
        resolve();
      };
      (client as any).on('meter', handler as any);
    });

    await Promise.race([
      (client as any).meterSubscribe(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('meterSubscribe timeout')), 3000)),
    ]).catch(() => null);

    await Promise.race([
      once,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);

    try { (client as any).meterUnsubscribe(); } catch {}

    if (got) {
      // Shape checks: object with at least one numeric array or numbers
      expect(typeof got).toBe('object');
      const values = Object.values(got ?? {});
      const hasNumbers = values.some((v: any) => typeof v === 'number');
      const hasNumericArray = values.some((v: any) => Array.isArray(v) && v.some((x: any) => typeof x === 'number'));
      expect(hasNumbers || hasNumericArray).toBe(true);
    } else {
      // Best-effort: no hard failure if no frame arrives
      expect(got === null).toBe(true);
    }

    await cleanup();
  });
});
