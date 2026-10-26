import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Room } from "../src/network.js";
import { createGame, applyAction, owned } from "../src/engine.js";

// Tests the application's protocol with an in-memory transport, not WebRTC connectivity.
const registry = new Map();
class Connection extends EventEmitter {
  open = false;
  send(data) {
    if (!this.open) throw Error("Closed connection");
    queueMicrotask(() => {
      if (this.other.open) this.other.emit("data", structuredClone(data));
    });
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.emit("close");
    if (this.other.open) this.other.close();
  }
}
class MemoryPeer extends EventEmitter {
  constructor(id = crypto.randomUUID()) {
    super();
    this.id = id;
    this.connections = [];
    registry.set(id, this);
    queueMicrotask(() => this.emit("open", id));
  }
  connect(id) {
    const local = new Connection(),
      remote = new Connection();
    local.other = remote;
    remote.other = local;
    this.connections.push(local);
    registry.get(id).connections.push(remote);
    queueMicrotask(() => {
      registry.get(id).emit("connection", remote);
      local.open = remote.open = true;
      remote.emit("open");
      local.emit("open");
    });
    return local;
  }
  destroy() {
    this.connections.forEach((c) => c.close());
    registry.delete(this.id);
  }
  reconnect() {}
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("room protocol: identity, private snapshots, authoritative actions and reconnect", async (t) => {
  const storage = new Map();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
    },
  });
  const events = [];
  let state, guestId;
  const host = new Room((type, data) => {
    if (type === "action") {
      try {
        state = applyAction(state, data.actor, data.action);
        host.sync(state);
      } catch (e) {
        data.connection.send({ type: "error", message: e.message });
      }
    }
  }, MemoryPeer);
  let guest = new Room((type, data) => {
    events.push({ type, data });
    if (type === "identity") guestId = data;
  }, MemoryPeer);
  t.after(() => {
    guest.close();
    host.close();
    delete globalThis.sessionStorage;
  });
  host.create("Host");
  await settle();
  guest.join(host.code, "Guest");
  await settle();
  assert.equal(host.members.length, 2);
  assert.equal(guestId, 1);
  assert.equal(host.members[1].online, true);
  assert.ok(
    events.some((e) => e.type === "lobby" && e.data.members.length === 2),
  );
  state = createGame([
    { name: "Host" },
    { name: "Guest" },
    { name: "Bot", bot: true },
  ]);
  host.sync(state);
  await settle();
  let snapshot = events.filter((e) => e.type === "state").at(-1).data;
  assert.equal(snapshot.players[0].objective, null);
  assert.ok(snapshot.players[1].objective);
  assert.equal(snapshot.deck.length, 0);
  const source = owned(state, 0)[0].id;
  const before = state.board[source].armies;
  state = applyAction(state, 0, { type: "reinforce", to: source, count: 1 });
  host.sync(state);
  await settle();
  snapshot = events.filter((e) => e.type === "state").at(-1).data;
  assert.equal(snapshot.board[source].armies, before + 1);
  const revision = state.revision;
  guest.send({ type: "reinforce", to: source, count: 1, actor: 0 });
  await settle();
  assert.equal(state.revision, revision);
  assert.ok(
    events.some((e) => e.type === "error" && e.data === "Aguarde a sua vez."),
  );
  guest.close();
  await settle();
  assert.equal(host.members[1].online, false);
  guestId = null;
  guest = new Room((type, data) => {
    events.push({ type, data });
    if (type === "identity") guestId = data;
  }, MemoryPeer);
  guest.join(host.code, "Changed name");
  await settle();
  assert.equal(guestId, 1);
  assert.equal(host.members.length, 2);
  assert.equal(host.members[1].name, "Guest");
  assert.equal(host.members[1].online, true);
  snapshot = events.filter((e) => e.type === "state").at(-1).data;
  assert.equal(snapshot.revision, revision);
});
