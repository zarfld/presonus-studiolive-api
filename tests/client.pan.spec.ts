import { Client } from "../src/lib/Client";

jest.mock("../src/lib/util/DataClient", () => ({
  __esModule: true,
  default: () => {
    const listeners: Record<string, Function[]> = {};
    return {
      write: jest.fn((bytes: Buffer, _encoding: any, cb?: Function) => cb && cb(true)),
      connect: jest.fn(),
      destroy: jest.fn(),
      destroyed: false,
      addListener: jest.fn((evt: string, cb: Function) => {
        (listeners[evt] ||= []).push(cb);
      }),
      once: jest.fn((evt: string, cb: Function) => {
        (listeners[evt] ||= []).push((...args: any[]) => {
          cb(...args);
          // simple one-shot
          listeners[evt] = (listeners[evt] || []).filter((f) => f !== cb);
        });
      }),
      emit: (evt: string, ...args: any[]) => listeners[evt]?.forEach((cb) => cb(...args)),
    } as any;
  },
}));

// Minimal logger shim to avoid reference errors if any
(global as any).logger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  level: jest.fn(),
};

describe("Client.getPan", () => {
  test("returns mono pan from cache path", () => {
    const c = new Client({ host: "127.0.0.1", port: 53000 });
    // mono: /pan
    (c.state as any).set("line/ch1/link", 0);
    (c.state as any).set("line/ch1/pan", 33);
    const value = (c as any).getPan({ type: "LINE", channel: 1 });
    expect(value).toBe(33);
  });

  test("returns stereo width from cache path", () => {
    const c = new Client({ host: "127.0.0.1", port: 53000 });
    // stereo: /stereopan
    (c.state as any).set("line/ch5/link", 1);
    (c.state as any).set("line/ch5/stereopan", 77);
    const value = (c as any).getPan({ type: "LINE", channel: 5 });
    expect(value).toBe(77);
  });

  test("AUX linked uses stpan; returns null when aux not linked", () => {
    const c = new Client({ host: "127.0.0.1", port: 53000 });
    // linked aux 1/2
    (c.state as any).set("line/ch1/link", 1);
    (c.state as any).set("aux.ch1.link", 1);
    (c.state as any).set("line/ch1/aux12_stpan", 55);
    const st = (c as any).getPan({ type: "LINE", channel: 1, mixType: "AUX", mixNumber: 1 });
    expect(st).toBe(55);

    // not linked, returns null
    (c.state as any).set("aux.ch3.link", 0);
    const nl = (c as any).getPan({ type: "LINE", channel: 1, mixType: "AUX", mixNumber: 3 });
    expect(nl).toBeNull();
  });
});
