import { Client } from "../../src/lib/Client";
import { MessageCode } from "../../src/lib/constants";

// Non-destructive integration tests that require a real mixer on the network.
// Uses built-in discovery (UDP) — no hardcoded hosts.

describe("Live Mixer Integration (Discovery)", () => {
  // Give hardware and discovery sufficient time on CI/hardware networks
  jest.setTimeout(90000);

  // Basic logger shim if global logger is expected
  (global as any).logger = (global as any).logger || {
    info: () => {},
    debug: () => {},
    warn: () => {},
    level: () => {},
  };

  // Opt-in verbose test logging
  const TEST_LOG_ENABLED = (process.env.TEST_LOG === '1' || process.env.TEST_LOG === 'true');
  const tlog = (...args: any[]) => { if (TEST_LOG_ENABLED) { /* eslint-disable no-console */ console.info('[live-test]', ...args); } };

  test("discovers a mixer, connects, subscribes meters, and closes cleanly (no-op if none found)", async () => {
    // Reduce verbose UBJSON debug in tests
    process.env.NODE_ENV = process.env.NODE_ENV || 'production';
    // Allow handshake to fail fast instead of stalling
    process.env.PRESONUS_HANDSHAKE_TIMEOUT_MS = process.env.PRESONUS_HANDSHAKE_TIMEOUT_MS || '12000';

    tlog('starting discovery', { timeoutMs: 6000 });
    let devices = await (Client as any).discover({ timeout: 6000 });
    tlog('discovery results', devices?.map((d: any) => ({ name: d.name, serial: d.serial, ip: d.ip })));

    // Optional deterministic selection via env
    const serialFilter = process.env.PRESONUS_SERIAL?.trim();
    const nameFilter = process.env.PRESONUS_NAME?.trim();
    if (serialFilter) devices = devices.filter((d: any) => d.serial === serialFilter);
    else if (nameFilter) devices = devices.filter((d: any) => d.name?.includes(nameFilter));

    if (!devices || devices.length === 0) {
      tlog('no-op path triggered: no devices discovered');
      // eslint-disable-next-line no-console
      console.warn("No mixers discovered; skipping actions (no-op)");
      return; // no-op; treat as neutral outcome
    }

    const selected = devices[0];
    const { ip } = selected;
    tlog('selected device', { name: selected.name, serial: selected.serial, ip });
    const port = Number(process.env.MIXER_PORT || 53000);
    const client = new Client({ host: ip, port }, { autoreconnect: false });

    // Track event ordering
    const events: string[] = [];
    client.on("connected", () => { tlog('event: connected'); events.push("connected"); });
    client.on("disconnected", () => { tlog('event: disconnected'); events.push("disconnected"); });
    client.on("closed", () => { tlog('event: closed'); events.push("closed"); });
    client.on("error", (e) => {
      // surface error for debugging but don't fail immediately; rely on expectations
      // eslint-disable-next-line no-console
      console.error("Client error:", e);
    });

    // Kick off connect and wait for the 'connected' handshake event
    tlog('connecting', { host: ip, port });
    (client as any).connect().catch(() => {});
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('connect handshake timeout')), 20000);
      const onConn = () => { clearTimeout(t); client.off('connected' as any, onConn as any); resolve(); };
      client.on('connected' as any, onConn as any);
    });

    // Allow initial packets to update cache
    await new Promise((r) => setTimeout(r, 750));

    // Subscribe to meters and wait for at least one meter event (best-effort)
    let meterReceived = false;
    client.on("meter", () => { meterReceived = true; tlog('meter: received'); });

    // Best-effort meters: don't hang test if UDP bind is slow
    const subscribeTry = Promise.race([
      (client as any).meterSubscribe(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('meterSubscribe timeout')), 3000)),
    ]).then(() => tlog('meterSubscribe: attempted')).catch((err) => { tlog('meterSubscribe: timeout', String(err)); return null; });
    await subscribeTry;
    // Keep meters active a bit longer so the mixer UI shows the client during the test
    await new Promise((r) => setTimeout(r, 2000));
    try { (client as any).meterUnsubscribe(); } catch {}

    // Close the client and ensure clean shutdown; guard against hangs
    const closedPromise = new Promise<void>((resolve) => {
      const onClosed = () => { client.off("closed" as any, onClosed as any); resolve(); };
      client.on("closed" as any, onClosed as any);
    });

    const closeRace = Promise.race([
      (client as any).close().catch(() => {}),
      new Promise((_, rej) => setTimeout(() => rej(new Error('close timeout')), 5000)),
    ]).catch(() => null);

    // If close hangs, force-destroy underlying socket after a grace period
    await Promise.race([
      Promise.all([closeRace, closedPromise]).then(() => null),
      new Promise((resolve) => setTimeout(() => { try { (client as any).conn?.destroy(); } catch {}; resolve(null); }, 6000)),
    ]);

    // Give events a tick to flush
    await new Promise((r) => setTimeout(r, 250));
    tlog('events sequence', events);

    // Assertions: Expect connected, then disconnected, then closed
    expect(events[0]).toBe('connected');
    const idxDisc = events.indexOf('disconnected');
    const idxClosed = events.indexOf('closed');
    expect(idxDisc).toBeGreaterThanOrEqual(0);
    expect(idxClosed).toBeGreaterThan(idxDisc);
  });
});
