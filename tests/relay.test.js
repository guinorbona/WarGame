import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { createRelayServer } from "../server/index.js";
import { Room } from "../src/network.js";
import { normalizeRelayUrl } from "../src/relay-peer.js";
import { createGame, applyAction, owned } from "../src/engine.js";
const origin = "http://localhost:5173";
class TestSocket extends WebSocket {
  constructor(url) {
    super(url, { origin });
  }
}
async function waitFor(predicate) {
  const end = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > end) throw Error("Condition timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
test("relay URL requires TLS outside localhost and never accepts embedded credentials", () => {
  assert.equal(
    normalizeRelayUrl("https://example.com"),
    "wss://example.com/relay",
  );
  assert.equal(
    normalizeRelayUrl("ws://127.0.0.1:9002"),
    "ws://127.0.0.1:9002/relay",
  );
  for (const u of [
    "http://example.com",
    "wss://user:pass@example.com",
    "https://example.com?token=key",
    "garbage",
    "javascript:alert(1)",
  ])
    assert.throws(() => normalizeRelayUrl(u));
});
test("real WebSocket relay synchronizes private state, rejects spoofing and reconnects a player", async (t) => {
  const relay = createRelayServer({ allowedOrigins: [origin] });
  relay.server.listen(0, "127.0.0.1");
  await once(relay.server, "listening");
  const relayUrl = `ws://127.0.0.1:${relay.server.address().port}/relay`;
  const storage = new Map();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
    },
  });
  let state, identity, snapshot;
  const errors = [];
  const opts = { relayUrl, WebSocketImplementation: TestSocket };
  const host = new Room(
    (type, data) => {
      if (type === "action") {
        try {
          state = applyAction(state, data.actor, data.action);
          host.sync(state);
        } catch (e) {
          data.connection.send({ type: "error", message: e.message });
        }
      }
    },
    undefined,
    opts,
  );
  let guest = new Room(
    (type, data) => {
      if (type === "identity") identity = data;
      if (type === "state") snapshot = data;
      if (type === "error") errors.push(data);
    },
    undefined,
    opts,
  );
  let intruder;
  t.after(async () => {
    intruder?.terminate();
    guest.close();
    host.close();
    await relay.close();
    delete globalThis.sessionStorage;
  });
  host.create("Host");
  await waitFor(
    () => host.peer.socket.readyState === 1 && host.timers.size === 0,
  );
  guest.join(host.code, "Guest");
  await waitFor(() => identity === 1);
  state = createGame([
    { name: "Host" },
    { name: "Guest" },
    { name: "Bot", bot: true },
  ]);
  state.current = 1;
  host.sync(state);
  await waitFor(() => snapshot?.current === 1);
  assert.equal(snapshot.players[0].objective, null);
  assert.ok(snapshot.players[1].objective);
  assert.deepEqual(snapshot.deck, []);
  const target = owned(state, 1)[0].id,
    initial = state.board[target].armies;
  guest.send({ type: "reinforce", to: target, count: 1 });
  await waitFor(() => snapshot.board[target].armies === initial + 1);
  const revision = state.revision;
  intruder = new TestSocket(relayUrl);
  await once(intruder, "open");
  intruder.send(JSON.stringify({ type: "register", id: crypto.randomUUID() }));
  await once(intruder, "message");
  intruder.send(
    JSON.stringify({
      type: "data",
      connectionId: guest.connection.connectionId,
      data: { type: "action", action: { type: "next" } },
    }),
  );
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(state.revision, revision);
  guest.close();
  await waitFor(() => host.members[1].online === false);
  identity = null;
  snapshot = null;
  guest = new Room(
    (type, data) => {
      if (type === "identity") identity = data;
      if (type === "state") snapshot = data;
      if (type === "error") errors.push(data);
    },
    undefined,
    opts,
  );
  guest.join(host.code, "Guest renamed");
  await waitFor(() => identity === 1 && snapshot?.revision === revision);
  assert.equal(host.members.length, 2);
  assert.equal(host.members[1].name, "Guest");
  assert.deepEqual(errors, []);
});
test("relay rejects a browser origin outside the configured site", async (t) => {
  const relay = createRelayServer({ allowedOrigins: [origin] });
  relay.server.listen(0, "127.0.0.1");
  await once(relay.server, "listening");
  t.after(() => relay.close());
  const ws = new WebSocket(
    `ws://127.0.0.1:${relay.server.address().port}/relay`,
    { origin: "https://other.example" },
  );
  const [error] = await once(ws, "error");
  assert.match(error.message, /403/);
});
