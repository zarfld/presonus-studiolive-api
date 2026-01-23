import { withLiveClient } from './helpers/liveUtil';

// Read-only channel state tests against a real mixer (non-destructive).

describe('Live Mixer Channels (Read-Only)', () => {
  jest.setTimeout(90000);

  test('reads basic channel state (level/pan/mute/solo) without mutation', async () => {
    const session = await withLiveClient(6000);
    if (!session) {
      console.warn('No mixers discovered; skipping channel state test (no-op)');
      return;
    }

    const { client, cleanup } = session;

    // Check at least one LINE channel exists
    const lineCount = (client as any).channelCounts?.LINE ?? 0;
    if (!lineCount || lineCount < 1) {
      console.warn('No LINE channels reported; skipping');
      await cleanup();
      return;
    }

    const selector = { type: 'LINE', channel: 1 } as any;

    // Level present (may be number or null depending on state)
    const level = (client as any).getLevel(selector);
    expect(level === null || typeof level === 'number').toBe(true);

    // Pan (or width) presence (may be null if stereo/aux config not applicable)
    const pan = (client as any).getPan(selector);
    expect(pan === null || typeof pan === 'number').toBe(true);

    // Mute/Solo flags (may be null if not yet known)
    const mute = (client as any).getMute(selector);
    const solo = (client as any).getSolo(selector);
    expect([null, true, false]).toContain(mute as any);
    expect([null, true, false]).toContain(solo as any);

    await cleanup();
  });
});
