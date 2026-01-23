import { Client } from "../src/lib/Client";

describe("Client events", () => {
  test.skip("emits error and disconnected on socket error", async () => {
    // TODO: mock DataClient to invoke error and assert events
  });

  test.skip("emits error on parsing failure", async () => {
    // TODO: simulate malformed packet into handleRecvPacket
  });
});
