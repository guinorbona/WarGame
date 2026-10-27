import EventEmitter from "eventemitter3";

export function normalizeRelayUrl(value) {
  if (!value?.trim()) return "";
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw Error("Informe a URL completa do servidor de sala.");
  }
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "wss:" && !(local && url.protocol === "ws:"))
    throw Error("O servidor de sala precisa usar HTTPS ou WSS.");
  if (url.username || url.password || url.search || url.hash)
    throw Error("Use a URL do servidor sem senha, parâmetros ou fragmentos.");
  if (url.pathname === "/") url.pathname = "/relay";
  return url.href;
}
class RelayConnection extends EventEmitter {
  constructor(peer, id) {
    super();
    this.provider = peer;
    this.connectionId = id;
    this.open = false;
    this.closed = false;
  }
  send(data) {
    if (!this.open) throw Error("Sem conexão com a sala.");
    this.provider.write({
      type: "data",
      connectionId: this.connectionId,
      data,
    });
  }
  close() {
    if (this.closed) return;
    this.provider.write({
      type: "disconnect",
      connectionId: this.connectionId,
    });
    this.finish();
  }
  finish() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.provider.connections.delete(this.connectionId);
    this.emit("close");
  }
}
// PeerJS-compatible channel API, backed by a single TLS WebSocket instead of ICE.
export class RelayPeer extends EventEmitter {
  constructor(
    id = crypto.randomUUID(),
    { relayUrl, WebSocketImplementation = globalThis.WebSocket } = {},
  ) {
    super();
    this.id = id;
    this.url = normalizeRelayUrl(relayUrl);
    this.WebSocketImplementation = WebSocketImplementation;
    this.connections = new Map();
    this.destroyed = false;
    this.attempt = 0;
    this.openSocket();
  }
  openSocket() {
    if (this.destroyed) return;
    this.socket = new this.WebSocketImplementation(this.url);
    this.socket.addEventListener("open", () =>
      this.write({ type: "register", id: this.id }),
    );
    this.socket.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "registered") {
        this.attempt = 0;
        this.emit("open", this.id);
        return;
      }
      if (msg.type === "error") {
        this.emit("error", { type: msg.code });
        return;
      }
      if (msg.type === "incoming") {
        const c = new RelayConnection(this, msg.connectionId);
        this.connections.set(c.connectionId, c);
        c.open = true;
        this.emit("connection", c);
        queueMicrotask(() => {
          if (!c.closed) c.emit("open");
        });
        return;
      }
      const c = this.connections.get(msg.connectionId);
      if (!c) return;
      if (msg.type === "connected") {
        c.open = true;
        c.emit("open");
      }
      if (msg.type === "data" && c.open) c.emit("data", msg.data);
      if (msg.type === "closed") c.finish();
    });
    this.socket.addEventListener("error", () => {}); // close reports failures without duplicate messages
    this.socket.addEventListener("close", () => {
      for (const c of [...this.connections.values()]) c.finish();
      if (!this.destroyed) this.emit("disconnected");
    });
  }
  write(msg) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(msg));
  }
  connect(to) {
    const c = new RelayConnection(this, crypto.randomUUID());
    this.connections.set(c.connectionId, c);
    this.write({ type: "connect", to, connectionId: c.connectionId });
    return c;
  }
  reconnect() {
    if (
      this.destroyed ||
      this.reconnectTimer ||
      this.socket?.readyState === 0 ||
      this.socket?.readyState === 1
    )
      return;
    if (this.attempt >= 6) {
      this.emit("error", { type: "relay-unavailable" });
      return;
    }
    const delay = Math.min(15000, 1000 * 2 ** this.attempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }
  destroy() {
    this.destroyed = true;
    clearTimeout(this.reconnectTimer);
    for (const c of [...this.connections.values()]) c.close();
    this.socket?.close();
  }
}
