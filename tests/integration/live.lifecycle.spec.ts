import { withLiveClient } from './helpers/liveUtil';

describe('Live Mixer Lifecycle (Close Order)', () => {
  jest.setTimeout(60000);

  test('emits disconnected before closed, exactly once', async () => {
    const session = await withLiveClient(6000);
    if (!session) {
      // eslint-disable-next-line no-console
      console.warn('No mixers discovered; skipping lifecycle test (no-op)');
      return;
    }

    const { client } = session;

    const events: string[] = [];
    let disconnectedCount = 0;
    let closedCount = 0;
    client.on('connected' as any, () => events.push('connected'));
    client.on('disconnected' as any, () => { events.push('disconnected'); disconnectedCount++; });
    client.on('closed' as any, () => { events.push('closed'); closedCount++; });

    // Prepare close with cancellable timers to avoid open handles in Jest
    const rejectTimeout = (ms: number, message: string) => {
      let id: NodeJS.Timeout | null = null;
      const cancel = () => { if (id) { clearTimeout(id); id = null; } };
      const promise = new Promise<never>((_, rej) => { id = setTimeout(() => rej(new Error(message)), ms); });
      return { promise, cancel };
    };
    const resolveTimeout = (ms: number, fn?: () => void) => {
      let id: NodeJS.Timeout | null = null;
      const cancel = () => { if (id) { clearTimeout(id); id = null; } };
      const promise = new Promise<void>((resolve) => { id = setTimeout(() => { try { fn && fn(); } catch {} finally { resolve(); } }, ms); });
      return { promise, cancel };
    };

    const closedPromise = new Promise<void>((resolve) => {
      const onClosed = () => { client.off('closed' as any, onClosed as any); resolve(); };
      client.on('closed' as any, onClosed as any);
    });

    const closeTimeout = rejectTimeout(5000, 'close timeout');
    const destroyTimeout = resolveTimeout(6000, () => { try { (client as any).conn?.destroy(); } catch {} });

    const closeAttempt = Promise.race([
      (client as any).close().catch(() => {}),
      closeTimeout.promise,
    ]).catch(() => null);

    await Promise.race([
      Promise.all([closeAttempt, closedPromise]).then(() => undefined),
      destroyTimeout.promise,
    ]);

    // Cleanup timers
    closeTimeout.cancel();
    destroyTimeout.cancel();

    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 100));

    // Assertions: we connected already via helper; ensure disconnected before closed; one each
    const idxDisc = events.indexOf('disconnected');
    const idxClosed = events.indexOf('closed');
    expect(idxDisc).toBeGreaterThanOrEqual(0);
    expect(idxClosed).toBeGreaterThan(idxDisc);
    expect(disconnectedCount).toBe(1);
    expect(closedCount).toBe(1);
  });
});
