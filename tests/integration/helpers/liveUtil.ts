import { Client } from "../../../src/lib/Client";
import type DiscoveryType from "../../../src/lib/types/DiscoveryType";

const TEST_LOG_ENABLED = process.env.TEST_LOG === '1' || process.env.TEST_LOG === 'true';
const tlog = (...args: any[]) => { if (TEST_LOG_ENABLED) { /* eslint-disable no-console */ console.info('[live-test]', ...args); } };

export type LiveSession = {
  client: InstanceType<typeof Client>,
  device: DiscoveryType,
  cleanup: () => Promise<void>,
};

export async function discoverFirst(timeoutMs = 6000) {
  tlog('starting discovery', { timeoutMs });
  const devices: DiscoveryType[] = await (Client as any).discover({ timeout: timeoutMs });
  tlog('discovery results', devices?.map((d) => ({ name: d.name, serial: d.serial, ip: d.ip })));
  return devices;
}

export async function withLiveClient(timeoutMs = 6000): Promise<LiveSession | null> {
  const devices = await discoverFirst(timeoutMs);
  if (!devices || devices.length === 0) {
    tlog('no devices discovered');
    return null;
  }
  const device = devices[0];
  const port = Number(process.env.MIXER_PORT || 53000);
  const client = new Client({ host: device.ip, port }, { autoreconnect: false });

  process.env.PRESONUS_HANDSHAKE_TIMEOUT_MS = process.env.PRESONUS_HANDSHAKE_TIMEOUT_MS || '12000';
  tlog('connecting', { host: device.ip, port });
  (client as any).connect().catch(() => {});

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect handshake timeout')), 20000);
    const onConn = () => { clearTimeout(t); client.off('connected' as any, onConn as any); resolve(); };
    client.on('connected' as any, onConn as any);
  });

  const cleanup = async () => {
    tlog('cleanup: closing');
    // Helper to create cancellable timeouts so Jest doesn't detect open handles
    const rejectTimeout = (ms: number, message: string) => {
      let id: NodeJS.Timeout | null = null;
      let cancel = () => { if (id) { clearTimeout(id); id = null; } };
      const promise = new Promise<never>((_, rej) => { id = setTimeout(() => rej(new Error(message)), ms); });
      return { promise, cancel };
    };
    const resolveTimeout = (ms: number, fn?: () => void) => {
      let id: NodeJS.Timeout | null = null;
      let cancel = () => { if (id) { clearTimeout(id); id = null; } };
      const promise = new Promise<void>((resolve) => { id = setTimeout(() => { try { fn && fn(); } catch {} finally { resolve(); } }, ms); });
      return { promise, cancel };
    };

    // Wait for 'closed' event while attempting graceful close with safeguards
    let closedHandler: any;
    const closedPromise = new Promise<void>((resolve) => {
      closedHandler = () => { client.off('closed' as any, closedHandler as any); resolve(); };
      client.on('closed' as any, closedHandler as any);
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

    // Cleanup timers to avoid open handle warnings in Jest
    closeTimeout.cancel();
    destroyTimeout.cancel();
  };

  return { client, device, cleanup };
}
