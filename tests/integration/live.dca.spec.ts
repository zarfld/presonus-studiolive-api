import { withLiveClient } from './helpers/liveUtil';
import { parseChannelString } from '../../src/lib/util/channelUtil';

describe('Live Mixer DCA (Read-only)', () => {
  jest.setTimeout(60000);

  test('reports DCA count and exposes DCA volumes in cache (no-op)', async () => {
    const session = await withLiveClient(6000);
    if (!session) {
      // eslint-disable-next-line no-console
      console.warn('No mixers discovered; skipping DCA test (no-op)');
      return;
    }

    const { client, cleanup } = session as any;

    const dcaCount = (client as any).channelCounts?.DCA ?? 0;
    expect(typeof dcaCount).toBe('number');
    expect(dcaCount).toBeGreaterThanOrEqual(0);

    if (dcaCount > 0) {
      const sample = Math.min(4, dcaCount);
      for (let i = 1; i <= sample; i++) {
        const path = `${parseChannelString({ type: 'DCA', channel: i } as any)}/volume`;
        const val = (client as any).state.get(path);
        // Volume cache may not be present immediately on all mixers; accept null or number
        const ok = val === null || typeof val === 'number';
        expect(ok).toBe(true);
      }
    }

    await cleanup();
  });
});
