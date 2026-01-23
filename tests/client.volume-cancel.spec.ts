import { Client } from "../src/lib/Client";

jest.mock("../src/lib/util/DataClient", () => ({
  __esModule: true,
  default: () => ({
    write: jest.fn((bytes: Buffer, _encoding: any, cb?: Function) => cb && cb(true)),
    connect: jest.fn(),
    destroy: jest.fn(),
    destroyed: false,
    addListener: jest.fn(),
    once: jest.fn(),
  }),
}));

(global as any).logger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  level: jest.fn(),
};

describe("Client volume transitions", () => {
  test("AbortSignal cancels transition and avoids final set", async () => {
    const c = new Client({ host: "127.0.0.1" });
    (c.state as any).set("line/ch1/volume", 10);
    const spy = jest.spyOn(c as any, "_sendPacket");

    const ac = new AbortController();
    const p = (c as any).setChannelVolumeLinear({ type: "LINE", channel: 1 }, 80, 200, { signal: ac.signal });
    // abort immediately
    ac.abort();

    await expect(p).resolves.toBeNull();

    // ensure we did not set final target after cancel; intermediate sends may have occurred
    const lastArgs = spy.mock.calls[spy.mock.calls.length - 1];
    if (lastArgs) {
      const payload: Buffer = lastArgs[1] as Buffer;
      const levelBytes = payload.subarray(payload.length - 4);
      const finalValue = levelBytes.readFloatBE(0);
      expect(finalValue).not.toBeCloseTo(0.8, 3);
    }
  });
});
