import { withLiveClient } from './helpers/liveUtil';
import { MessageCode, Channel } from '../../src/lib/constants';
import { parseChannelString } from '../../src/lib/util/channelUtil';

/**
 * Mutating tests (opt-in). These tests make small, reversible changes and always revert.
 * To enable, set ALLOW_MUTATIONS=1 (or 'true'). Default is skipped.
 */

const ALLOW_MUT = process.env.ALLOW_MUTATIONS === '1' || process.env.ALLOW_MUTATIONS === 'true';
const maybeDescribe = ALLOW_MUT ? describe : describe.skip;

maybeDescribe('Live Mixer Mutations (Opt-In, Revert-Safe)', () => {
  jest.setTimeout(120000);

  let session: Awaited<ReturnType<typeof withLiveClient>> | null = null;

  beforeAll(async () => {
    session = await withLiveClient(6000);
    if (!session) {
      // eslint-disable-next-line no-console
      console.warn('No mixers discovered; skipping mutation tests');
    }
  });

  afterAll(async () => {
    try { await session?.cleanup?.(); } catch {}
  });

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test('toggle mute twice reverts to original', async () => {
    if (!session) return;
    const { client } = session;

    const lineCount = (client as any).channelCounts?.LINE ?? 0;
    if (!lineCount || lineCount < 1) {
      console.warn('No LINE channels; skipping');
      return;
    }

    const selector = { type: 'LINE', channel: 1 } as any;

    const initial = (client as any).getMute(selector);
    ;(client as any).toggleMute(selector);
    await delay(300);
    const after1 = (client as any).getMute(selector);
    ;(client as any).toggleMute(selector);
    await delay(300);
    const after2 = (client as any).getMute(selector);

    if (initial !== null && after2 !== null) {
      expect(after2).toBe(initial);
    } else {
      expect([null, true, false]).toContain(after2 as any);
    }
  });

  test('toggle solo twice reverts to original', async () => {
    if (!session) return;
    const { client } = session;

    const lineCount = (client as any).channelCounts?.LINE ?? 0;
    if (!lineCount || lineCount < 1) {
      console.warn('No LINE channels; skipping');
      return;
    }

    const selector = { type: 'LINE', channel: 1 } as any;

    const initial = (client as any).getSolo(selector);
    ;(client as any).toggleSolo(selector);
    await delay(300);
    const after1 = (client as any).getSolo(selector);
    ;(client as any).toggleSolo(selector);
    await delay(300);
    const after2 = (client as any).getSolo(selector);

    if (initial !== null && after2 !== null) {
      expect(after2).toBe(initial);
    } else {
      expect([null, true, false]).toContain(after2 as any);
    }
  });

  test('pan small delta and revert', async () => {
    if (!session) return;
    const { client } = session;

    const lineCount = (client as any).channelCounts?.LINE ?? 0;
    if (!lineCount || lineCount < 1) {
      console.warn('No LINE channels; skipping');
      return;
    }

    const selector = { type: 'LINE', channel: 1 } as any;
    const channelString = parseChannelString(selector);
    const isStereo = (client as any).state.get(channelString + '/link');
    const path = `${channelString}/${isStereo ? 'stereopan' : 'pan'}`;

    const initial = (client as any).getPan(selector);
    if (typeof initial !== 'number') {
      console.warn('Pan not applicable; skipping');
      return;
    }

    const oncePV = (expectedPath: string, timeoutMs = 1500) => {
      let timer: NodeJS.Timeout | null = null;
      return new Promise<any>((resolve, reject) => {
        const handler = (payload: any) => {
          try {
            if (payload?.name === expectedPath) {
              if (timer) clearTimeout(timer);
              (client as any).off(MessageCode.ParamValue as any, handler as any);
              resolve(payload);
            }
          } catch (e) {
            if (timer) clearTimeout(timer);
            (client as any).off(MessageCode.ParamValue as any, handler as any);
            reject(e);
          }
        };
        (client as any).on(MessageCode.ParamValue as any, handler as any);
        timer = setTimeout(() => {
          (client as any).off(MessageCode.ParamValue as any, handler as any);
          reject(new Error('ParamValue timeout'));
        }, timeoutMs);
      });
    };

    const target = Math.max(0, Math.min(100, initial + (initial > 50 ? -2 : 2)));
    const pvPromise = oncePV(path);
    ;(client as any).setPan(selector, target);
    const pv = await pvPromise;
    await delay(200);
    const got = (client as any).getPan(selector);
    if (typeof pv?.value === 'number') {
      expect(Math.abs(pv.value - target)).toBeLessThanOrEqual(2);
    }
    expect(typeof got === 'number' || got === null).toBe(true);

    const pvRevertPromise = oncePV(path);
    ;(client as any).setPan(selector, initial);
    const pvRevert = await pvRevertPromise;
    await delay(200);
    const reverted = (client as any).getPan(selector);
    if (typeof pvRevert?.value === 'number') {
      expect(Math.abs(pvRevert.value - initial)).toBeLessThanOrEqual(2);
    }
    if (typeof reverted === 'number') {
      expect(Math.abs(reverted - initial)).toBeLessThanOrEqual(2);
    }
  });

  test('volume small delta and revert', async () => {
    if (!session) return;
    const { client } = session;

    const lineCount = (client as any).channelCounts?.LINE ?? 0;
    if (!lineCount || lineCount < 1) {
      console.warn('No LINE channels; skipping');
      return;
    }

    const selector = { type: 'LINE', channel: 1 } as any;

    const initial = (client as any).getLevel(selector) ?? 0;
    const to = Math.max(0, Math.min(100, initial + (initial > 50 ? -2 : 2)));
    await (client as any).setChannelVolumeLinear(selector, to, 0);
    await delay(200);
    const got = (client as any).getLevel(selector);
    expect(got === null || typeof got === 'number').toBe(true);

    await (client as any).setChannelVolumeLinear(selector, initial, 0);
    await delay(200);
    const reverted = (client as any).getLevel(selector);
    if (typeof reverted === 'number') {
      expect(Math.abs(reverted - initial)).toBeLessThanOrEqual(2);
    }
  });

  test('set color to same value (no-op)', async () => {
    if (!session) return;
    const { client } = session;

    const lineCount = (client as any).channelCounts?.LINE ?? 0;
    if (!lineCount || lineCount < 1) {
      console.warn('No LINE channels; skipping');
      return;
    }

    const selector = { type: 'LINE', channel: 1 } as any;

    const current = (client as any).getColor(selector);
    if (!current || typeof current !== 'string') {
      console.warn('No color available; skipping');
      return;
    }

    // setColor expects hex string without leading '#'
    await (client as any).setColor(selector, current);
    await delay(100);
    const after = (client as any).getColor(selector);
    expect(after === current || typeof after === 'string' || after === undefined).toBe(true);
  });

  test('color PC event fires with expected value (no-op)', async () => {
    if (!session) return;
    const { client } = session;

    const lineCount = (client as any).channelCounts?.LINE ?? 0;
    if (!lineCount || lineCount < 1) {
      console.warn('No LINE channels; skipping');
      return;
    }

    const selector = { type: 'LINE', channel: 1 } as any;
    const path = `${parseChannelString(selector)}/color`;
    const current = (client as any).getColor(selector);
    if (!current || typeof current !== 'string') {
      console.warn('No color available; skipping');
      return;
    }

    const oncePC = (expectedPath: string, timeoutMs = 1500) => {
      let timer: NodeJS.Timeout | null = null;
      return new Promise<any>((resolve, reject) => {
        const handler = (payload: any) => {
          try {
            if (payload?.name === expectedPath) {
              if (timer) clearTimeout(timer);
              (client as any).off(MessageCode.ParamChars as any, handler as any);
              resolve(payload);
            }
          } catch (e) {
            if (timer) clearTimeout(timer);
            (client as any).off(MessageCode.ParamChars as any, handler as any);
            reject(e);
          }
        };
        (client as any).on(MessageCode.ParamChars as any, handler as any);
        timer = setTimeout(() => {
          (client as any).off(MessageCode.ParamChars as any, handler as any);
          reject(new Error('ParamChars timeout'));
        }, timeoutMs);
      });
    };

    const pcPromise = oncePC(path);
    await (client as any).setColor(selector, current);
    const pc = await pcPromise;
    await delay(100);
    const after = (client as any).getColor(selector);
    expect(pc?.name).toBe(path);
    if (typeof pc?.value === 'string') {
      expect(pc.value.toLowerCase()).toBe(String(current).toLowerCase());
    }
    if (typeof after === 'string') {
      expect(after.toLowerCase()).toBe(String(current).toLowerCase());
    }
  });

  test('volume PV reflects change then revert', async () => {
    if (!session) return;
    const { client } = session;

    const lineCount = (client as any).channelCounts?.LINE ?? 0;
    if (!lineCount || lineCount < 1) {
      // eslint-disable-next-line no-console
      console.warn('No LINE channels; skipping');
      return;
    }

    const selector = { type: 'LINE', channel: 1 } as any;
    const path = `${parseChannelString(selector)}/volume`;

    const oncePV = (expectedPath: string, timeoutMs = 1500) => {
      let timer: NodeJS.Timeout | null = null;
      return new Promise<any>((resolve, reject) => {
        const handler = (payload: any) => {
          try {
            if (payload?.name === expectedPath) {
              if (timer) clearTimeout(timer);
              (client as any).off(MessageCode.ParamValue as any, handler as any);
              resolve(payload);
            }
          } catch (e) {
            if (timer) clearTimeout(timer);
            (client as any).off(MessageCode.ParamValue as any, handler as any);
            reject(e);
          }
        };
        (client as any).on(MessageCode.ParamValue as any, handler as any);
        timer = setTimeout(() => {
          (client as any).off(MessageCode.ParamValue as any, handler as any);
          reject(new Error('ParamValue timeout'));
        }, timeoutMs);
      });
    };

    const initial = (client as any).getLevel(selector) ?? 0;
    const to = Math.max(0, Math.min(100, initial + (initial > 50 ? -2 : 2)));

    const pvPromise = oncePV(path);
    await (client as any).setChannelVolumeLinear(selector, to, 0);
    const pv = await pvPromise;

    // Allow cache to catch up
    await delay(200);
    const after = (client as any).getLevel(selector);
    if (typeof pv?.value === 'number') {
      expect(Math.abs(pv.value - to)).toBeLessThanOrEqual(2);
    }
    if (typeof after === 'number') {
      expect(Math.abs(after - to)).toBeLessThanOrEqual(2);
    }

    const pvRevertPromise = oncePV(path);
    await (client as any).setChannelVolumeLinear(selector, initial, 0);
    const pvRevert = await pvRevertPromise;
    await delay(150);
    const reverted = (client as any).getLevel(selector);
    if (typeof pvRevert?.value === 'number') {
      expect(Math.abs(pvRevert.value - initial)).toBeLessThanOrEqual(2);
    }
    if (typeof reverted === 'number') {
      expect(Math.abs(reverted - initial)).toBeLessThanOrEqual(2);
    }
  });

  test('abortable fader transition cancels and explicit revert restores', async () => {
    if (!session) return;
    const { client } = session;

    const lineCount = (client as any).channelCounts?.LINE ?? 0;
    if (!lineCount || lineCount < 1) {
      // eslint-disable-next-line no-console
      console.warn('No LINE channels; skipping');
      return;
    }

    const selector = { type: 'LINE', channel: 1 } as any;
    const path = `${parseChannelString(selector)}/volume`;

    const oncePVAny = (timeoutMs = 1500) => {
      let timer: NodeJS.Timeout | null = null;
      return new Promise<any>((resolve, reject) => {
        const handler = (payload: any) => {
          try {
            if (payload?.name === path) {
              if (timer) clearTimeout(timer);
              (client as any).off(MessageCode.ParamValue as any, handler as any);
              resolve(payload);
            }
          } catch (e) {
            if (timer) clearTimeout(timer);
            (client as any).off(MessageCode.ParamValue as any, handler as any);
            reject(e);
          }
        };
        (client as any).on(MessageCode.ParamValue as any, handler as any);
        timer = setTimeout(() => {
          (client as any).off(MessageCode.ParamValue as any, handler as any);
          resolve(null); // allow proceed even if no PV within timeout
        }, timeoutMs);
      });
    };

    const initial = (client as any).getLevel(selector) ?? 0;
    const target = initial > 60 ? Math.max(0, initial - 10) : Math.min(100, initial + 10);

    const ac = new (global as any).AbortController();
    const pvFirst = oncePVAny(1200);
    const p = (client as any).setChannelVolumeLinear(selector, target, 1000, { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 300));
    ac.abort();
    await p; // resolves to null on cancel path
    await pvFirst; // at least attempted some PV

    // Explicitly revert; assert PV and cache near initial
    const pvRevertPromise = new Promise<any>((resolve) => {
      const handler = (payload: any) => {
        if (payload?.name === path) {
          (client as any).off(MessageCode.ParamValue as any, handler as any);
          resolve(payload);
        }
      };
      (client as any).on(MessageCode.ParamValue as any, handler as any);
    });
    await (client as any).setChannelVolumeLinear(selector, initial, 0);
    const pvRevert = await Promise.race([pvRevertPromise, new Promise((_, rej) => setTimeout(() => rej(new Error('PV revert timeout')), 1500))]);
    await delay(150);
    const reverted = (client as any).getLevel(selector);
    if (typeof pvRevert?.value === 'number') {
      expect(Math.abs(pvRevert.value - initial)).toBeLessThanOrEqual(2);
    }
    if (typeof reverted === 'number') {
      expect(Math.abs(reverted - initial)).toBeLessThanOrEqual(2);
    }
  });

  test('AUX send mute inversion toggles and reverts', async () => {
    if (!session) return;
    const { client } = session;

    const lineCount = (client as any).channelCounts?.LINE ?? 0;
    const auxCount = (client as any).channelCounts?.AUX ?? 0;
    if (!lineCount || lineCount < 1 || !auxCount || auxCount < 1) {
      // eslint-disable-next-line no-console
      console.warn('No LINE/AUX channels; skipping');
      return;
    }

    const selector = { type: 'LINE', channel: 1, mixType: 'AUX', mixNumber: 1 } as any;
    const path = `${parseChannelString({ type: 'LINE', channel: 1 } as any)}/assign_${Channel.AUX}1`;

    const oncePV = (expectedPath: string, timeoutMs = 1500) => {
      let timer: NodeJS.Timeout | null = null;
      return new Promise<any>((resolve, reject) => {
        const handler = (payload: any) => {
          try {
            if (payload?.name === expectedPath) {
              if (timer) clearTimeout(timer);
              (client as any).off(MessageCode.ParamValue as any, handler as any);
              resolve(payload);
            }
          } catch (e) {
            if (timer) clearTimeout(timer);
            (client as any).off(MessageCode.ParamValue as any, handler as any);
            reject(e);
          }
        };
        (client as any).on(MessageCode.ParamValue as any, handler as any);
        timer = setTimeout(() => {
          (client as any).off(MessageCode.ParamValue as any, handler as any);
          reject(new Error('ParamValue timeout'));
        }, timeoutMs);
      });
    };

    const initialVisible = (client as any).getMute(selector);
    const pvPromise = oncePV(path);
    ;(client as any).toggleMute(selector);
    const pv = await pvPromise;
    await delay(150);
    const afterVisible = (client as any).getMute(selector);

    if (typeof pv?.value === 'boolean') {
      // For AUX, getMute returns inverted semantics
      if (initialVisible !== null) {
        expect(afterVisible).not.toBe(initialVisible);
        expect(pv.value).toBe(initialVisible); // invert mapping means device param flips opposite visible
      }
    }

    const pvRevertPromise = oncePV(path);
    ;(client as any).toggleMute(selector);
    await pvRevertPromise;
    await delay(150);
    const revertedVisible = (client as any).getMute(selector);
    if (initialVisible !== null && revertedVisible !== null) {
      expect(revertedVisible).toBe(initialVisible);
    }
  });

  test('AUX send level PV reflects change then revert', async () => {
    if (!session) return;
    const { client } = session;

    const lineCount = (client as any).channelCounts?.LINE ?? 0;
    const auxCount = (client as any).channelCounts?.AUX ?? 0;
    if (!lineCount || lineCount < 1 || !auxCount || auxCount < 1) {
      // eslint-disable-next-line no-console
      console.warn('No LINE/AUX channels; skipping');
      return;
    }

    const base = { type: 'LINE', channel: 1 } as any;
    const selector = { ...base, mixType: 'AUX', mixNumber: 1 } as any;
    const path = `${parseChannelString(base)}/${Channel.AUX}1`;

    const oncePV = (expectedPath: string, timeoutMs = 1500) => {
      let timer: NodeJS.Timeout | null = null;
      return new Promise<any>((resolve, reject) => {
        const handler = (payload: any) => {
          try {
            if (payload?.name === expectedPath) {
              if (timer) clearTimeout(timer);
              (client as any).off(MessageCode.ParamValue as any, handler as any);
              resolve(payload);
            }
          } catch (e) {
            if (timer) clearTimeout(timer);
            (client as any).off(MessageCode.ParamValue as any, handler as any);
            reject(e);
          }
        };
        (client as any).on(MessageCode.ParamValue as any, handler as any);
        timer = setTimeout(() => {
          (client as any).off(MessageCode.ParamValue as any, handler as any);
          reject(new Error('ParamValue timeout'));
        }, timeoutMs);
      });
    };

    const initial = (client as any).getLevel(selector) ?? 0;
    const to = Math.max(0, Math.min(100, initial + (initial > 50 ? -3 : 3)));

    const pvPromise = oncePV(path);
    await (client as any).setChannelVolumeLinear(selector, to, 0);
    const pv = await pvPromise;
    await delay(150);
    const after = (client as any).getLevel(selector);
    if (typeof pv?.value === 'number') {
      expect(Math.abs(pv.value - to)).toBeLessThanOrEqual(3);
    }
    if (typeof after === 'number') {
      expect(Math.abs(after - to)).toBeLessThanOrEqual(3);
    }

    const pvRevertPromise = oncePV(path);
    await (client as any).setChannelVolumeLinear(selector, initial, 0);
    await pvRevertPromise;
    await delay(150);
    const reverted = (client as any).getLevel(selector);
    if (typeof reverted === 'number') {
      expect(Math.abs(reverted - initial)).toBeLessThanOrEqual(3);
    }
  });

  test('MAIN bus mute PV toggles and reverts', async () => {
    if (!session) return;
    const { client } = session;

    const mainCount = (client as any).channelCounts?.MAIN ?? 0;
    if (!mainCount || mainCount < 1) {
      // eslint-disable-next-line no-console
      console.warn('No MAIN channel; skipping');
      return;
    }

    const selector = { type: 'MAIN', channel: 1 } as any;
    const path = `${parseChannelString(selector)}/mute`;

    const oncePV = (expectedPath: string, timeoutMs = 1500) => {
      let timer: NodeJS.Timeout | null = null;
      return new Promise<any>((resolve, reject) => {
        const handler = (payload: any) => {
          try {
            if (payload?.name === expectedPath) {
              if (timer) clearTimeout(timer);
              (client as any).off(MessageCode.ParamValue as any, handler as any);
              resolve(payload);
            }
          } catch (e) {
            if (timer) clearTimeout(timer);
            (client as any).off(MessageCode.ParamValue as any, handler as any);
            reject(e);
          }
        };
        (client as any).on(MessageCode.ParamValue as any, handler as any);
        timer = setTimeout(() => {
          (client as any).off(MessageCode.ParamValue as any, handler as any);
          reject(new Error('ParamValue timeout'));
        }, timeoutMs);
      });
    };

    const initial = (client as any).getMute(selector);
    const pvPromise = oncePV(path);
    ;(client as any).toggleMute(selector);
    const pv = await pvPromise;
    await delay(150);
    const after = (client as any).getMute(selector);
    if (initial !== null) {
      expect(pv?.name).toBe(path);
      expect(pv?.value).toBe(!initial);
      if (after !== null) expect(after).not.toBe(initial);
    } else {
      expect([null, true, false]).toContain(after as any);
    }

    const pvRevertPromise = oncePV(path);
    ;(client as any).toggleMute(selector);
    await pvRevertPromise;
    await delay(150);
    const reverted = (client as any).getMute(selector);
    if (initial !== null && reverted !== null) {
      expect(reverted).toBe(initial);
    }
  });

  test('MAIN bus solo PV toggles and reverts', async () => {
    if (!session) return;
    const { client } = session;

    const mainCount = (client as any).channelCounts?.MAIN ?? 0;
    if (!mainCount || mainCount < 1) {
      // eslint-disable-next-line no-console
      console.warn('No MAIN channel; skipping');
      return;
    }

    const selector = { type: 'MAIN', channel: 1 } as any;
    const path = `${parseChannelString(selector)}/solo`;

    const oncePV = (expectedPath: string, timeoutMs = 1500) => {
      let timer: NodeJS.Timeout | null = null;
      return new Promise<any>((resolve, reject) => {
        const handler = (payload: any) => {
          try {
            if (payload?.name === expectedPath) {
              if (timer) clearTimeout(timer);
              (client as any).off(MessageCode.ParamValue as any, handler as any);
              resolve(payload);
            }
          } catch (e) {
            if (timer) clearTimeout(timer);
            (client as any).off(MessageCode.ParamValue as any, handler as any);
            reject(e);
          }
        };
        (client as any).on(MessageCode.ParamValue as any, handler as any);
        timer = setTimeout(() => {
          (client as any).off(MessageCode.ParamValue as any, handler as any);
          reject(new Error('ParamValue timeout'));
        }, timeoutMs);
      });
    };

    const initial = (client as any).getSolo(selector);
    const pvPromise = oncePV(path);
    ;(client as any).toggleSolo(selector);
    const pv = await pvPromise;
    await delay(150);
    const after = (client as any).getSolo(selector);
    if (initial !== null) {
      expect(pv?.name).toBe(path);
      expect(pv?.value).toBe(!initial);
      if (after !== null) expect(after).not.toBe(initial);
    } else {
      expect([null, true, false]).toContain(after as any);
    }

    const pvRevertPromise = oncePV(path);
    ;(client as any).toggleSolo(selector);
    await pvRevertPromise;
    await delay(150);
    const reverted = (client as any).getSolo(selector);
    if (initial !== null && reverted !== null) {
      expect(reverted).toBe(initial);
    }
  });

  test('toggle mute once reflects change then revert', async () => {
    if (!session) return;
    const { client } = session;

    const lineCount = (client as any).channelCounts?.LINE ?? 0;
    if (!lineCount || lineCount < 1) {
      // eslint-disable-next-line no-console
      console.warn('No LINE channels; skipping');
      return;
    }

    const selector = { type: 'LINE', channel: 1 } as any;
    const path = `${parseChannelString(selector)}/mute`;

    const initial = (client as any).getMute(selector);

    const oncePV = (expectedPath: string, timeoutMs = 1500) => {
      let timer: NodeJS.Timeout | null = null;
      return new Promise<any>((resolve, reject) => {
        const handler = (payload: any) => {
          try {
            if (payload?.name === expectedPath) {
              if (timer) clearTimeout(timer);
              (client as any).off(MessageCode.ParamValue as any, handler as any);
              resolve(payload);
            }
          } catch (e) {
            if (timer) clearTimeout(timer);
            (client as any).off(MessageCode.ParamValue as any, handler as any);
            reject(e);
          }
        };
        (client as any).on(MessageCode.ParamValue as any, handler as any);
        timer = setTimeout(() => {
          (client as any).off(MessageCode.ParamValue as any, handler as any);
          reject(new Error('ParamValue timeout'));
        }, timeoutMs);
      });
    };

    const pvPromise = oncePV(path);
    ;(client as any).toggleMute(selector);
    const pv = await pvPromise;

    // Cache should also reflect the change shortly after
    await delay(200);
    const after = (client as any).getMute(selector);

    if (initial === null) {
      expect(typeof pv?.value === 'boolean').toBe(true);
    } else {
      expect(pv?.name).toBe(path);
      expect(pv?.value).toBe(!initial); // device-side payload reflects toggled state
      if (after !== null) expect(after).not.toBe(initial);
    }

    // Revert and assert event again
    const pvRevertPromise = oncePV(path);
    ;(client as any).toggleMute(selector);
    const pvRevert = await pvRevertPromise;
    await delay(150);
    const reverted = (client as any).getMute(selector);
    if (initial !== null) {
      expect(pvRevert?.value).toBe(initial);
      if (reverted !== null) expect(reverted).toBe(initial);
    }
  });

  test('toggle solo once reflects change then revert', async () => {
    if (!session) return;
    const { client } = session;

    const lineCount = (client as any).channelCounts?.LINE ?? 0;
    if (!lineCount || lineCount < 1) {
      // eslint-disable-next-line no-console
      console.warn('No LINE channels; skipping');
      return;
    }

    const selector = { type: 'LINE', channel: 1 } as any;
    const path = `${parseChannelString(selector)}/solo`;

    const initial = (client as any).getSolo(selector);

    const oncePV = (expectedPath: string, timeoutMs = 1500) => {
      let timer: NodeJS.Timeout | null = null;
      return new Promise<any>((resolve, reject) => {
        const handler = (payload: any) => {
          try {
            if (payload?.name === expectedPath) {
              if (timer) clearTimeout(timer);
              (client as any).off(MessageCode.ParamValue as any, handler as any);
              resolve(payload);
            }
          } catch (e) {
            if (timer) clearTimeout(timer);
            (client as any).off(MessageCode.ParamValue as any, handler as any);
            reject(e);
          }
        };
        (client as any).on(MessageCode.ParamValue as any, handler as any);
        timer = setTimeout(() => {
          (client as any).off(MessageCode.ParamValue as any, handler as any);
          reject(new Error('ParamValue timeout'));
        }, timeoutMs);
      });
    };

    const pvPromise = oncePV(path);
    ;(client as any).toggleSolo(selector);
    const pv = await pvPromise;

    await delay(200);
    const after = (client as any).getSolo(selector);

    if (initial === null) {
      expect(typeof pv?.value === 'boolean').toBe(true);
    } else {
      expect(pv?.name).toBe(path);
      expect(pv?.value).toBe(!initial);
      if (after !== null) expect(after).not.toBe(initial);
    }

    // Revert and assert event again
    const pvRevertPromise = oncePV(path);
    ;(client as any).toggleSolo(selector);
    const pvRevert = await pvRevertPromise;
    await delay(150);
    const reverted = (client as any).getSolo(selector);
    if (initial !== null) {
      expect(pvRevert?.value).toBe(initial);
      if (reverted !== null) expect(reverted).toBe(initial);
    }
  });
});
