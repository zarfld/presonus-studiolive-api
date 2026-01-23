import { Client } from "../src/lib/Client";

jest.mock("../src/lib/Discovery", () => ({
  __esModule: true,
  default: class MockDiscovery {
    private listeners: Record<string, Function[]> = {};
    on(evt: string, cb: Function) { (this.listeners[evt] ||= []).push(cb); }
    off(evt: string, cb: Function) { this.listeners[evt] = (this.listeners[evt]||[]).filter(f=>f!==cb); }
    async start(opts: any) {
      // emit a few devices then respect filter/signal
      const emit = (d: any) => (this.listeners["discover"]||[]).forEach(cb => cb(d));
      emit({ name: "64S", serial: "A", ip: "1.1.1.1", port: 1, timestamp: new Date() });
      emit({ name: "16R", serial: "B", ip: "1.1.1.2", port: 2, timestamp: new Date() });
      if (opts?.signal?.aborted) return;
      return;
    }
  }
}));

describe("Discovery QoL", () => {
  test("filter produces only matching devices", async () => {
    const devices = await (Client as any).discover({ timeout: 100, filter: (d:any) => d.name === "64S" });
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe("64S");
  });

  test.skip("AbortSignal cancels mid-scan", async () => {
    // TODO: verify resolve triggers early with abort
  });
});
