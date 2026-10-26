import Peer from "peerjs";
import { viewFor } from "./engine.js";

export class Room {
  constructor(onEvent, PeerImplementation = Peer) {
    this.PeerImplementation = PeerImplementation;
    this.onEvent = onEvent;
    this.connections = new Map();
    this.members = [];
    this.host = false;
    this.closed = false;
  }
  emit(type, payload) {
    if (!this.closed) this.onEvent(type, payload);
  }
  init(id) {
    const env = import.meta.env || {};
    const custom = env.VITE_PEER_HOST
      ? {
          host: env.VITE_PEER_HOST,
          port: Number(env.VITE_PEER_PORT || 443),
          path: env.VITE_PEER_PATH || "/",
          secure: env.VITE_PEER_SECURE !== "false",
        }
      : {};
    const rtc = env.VITE_PEER_ICE_SERVERS
      ? {
          config: {
            iceServers: JSON.parse(env.VITE_PEER_ICE_SERVERS),
          },
        }
      : {};
    this.peer = new this.PeerImplementation(id, {
      debug: 0,
      ...custom,
      ...rtc,
    });
    this.peer.on("error", (e) =>
      this.emit(
        "error",
        e.type === "peer-unavailable"
          ? "Sala não encontrada. Confira o código e se o anfitrião está conectado."
          : `Falha na conexão (${e.type}). Tente novamente ou use o modo solo.`,
      ),
    );
    this.peer.on("disconnected", () => {
      this.emit("notice", "A sinalização desconectou. Tentando reconectar…");
      if (!this.closed) this.peer.reconnect();
    });
  }
  create(name) {
    this.host = true;
    this.code = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
    this.members = [{ token: "host", name, id: 0, online: true }];
    this.init(`war-mesa-${this.code}`);
    this.peer.on("open", () =>
      this.emit("lobby", {
        code: this.code,
        members: this.publicMembers(),
        host: true,
      }),
    );
    this.peer.on("connection", (c) => {
      let member = null;
      const timeout = setTimeout(() => {
        if (!member) c.close();
      }, 10000);
      c.on("data", (data) => {
        if (!data || typeof data !== "object") return;
        if (!member) {
          if (
            data.type !== "hello" ||
            typeof data.token !== "string" ||
            !/^[a-f0-9-]{36}$/.test(data.token) ||
            typeof data.name !== "string"
          )
            return;
          member = this.members.find((m) => m.token === data.token);
          if (!member) {
            if (this.state || this.members.length >= 6) {
              c.send({
                type: "error",
                message: this.state
                  ? "A partida já começou."
                  : "A sala está cheia.",
              });
              setTimeout(() => c.close(), 200);
              return;
            }
            member = {
              token: data.token,
              name: data.name.trim().slice(0, 20) || "Comandante",
              id: this.members.length,
              online: true,
            };
            this.members.push(member);
          }
          clearTimeout(timeout);
          const old = this.connections.get(member.token);
          if (old && old !== c) old.close();
          member.online = true;
          this.connections.set(member.token, c);
          c.send({ type: "identity", id: member.id });
          this.broadcast();
        } else if (
          data.type === "action" &&
          this.state &&
          this.connections.get(member.token) === c
        ) {
          this.emit("action", {
            actor: member.id,
            action: data.action,
            connection: c,
          });
        }
      });
      c.on("close", () => {
        clearTimeout(timeout);
        if (member && this.connections.get(member.token) === c) {
          member.online = false;
          this.connections.delete(member.token);
          this.broadcast();
        }
      });
      c.on("error", () => {});
    });
  }
  join(code, name) {
    this.code = code.toLowerCase().trim();
    if (!/^[a-f0-9]{10}$/.test(this.code)) {
      this.emit("error", "O código da sala deve ter 10 caracteres.");
      return;
    }
    const key = `war-token-${this.code}`;
    let token = sessionStorage.getItem(key);
    if (!token) {
      token = crypto.randomUUID();
      sessionStorage.setItem(key, token);
    }
    this.init();
    this.peer.on("open", () => {
      const c = this.peer.connect(`war-mesa-${this.code}`, { reliable: true });
      this.connection = c;
      const timeout = setTimeout(() => {
        if (!c.open)
          this.emit(
            "error",
            "A conexão demorou demais. O anfitrião precisa manter a sala aberta. Algumas redes exigem um servidor TURN.",
          );
      }, 18000);
      c.on("open", () => {
        clearTimeout(timeout);
        c.send({ type: "hello", name, token });
      });
      c.on("data", (data) => {
        if (data.type === "identity") this.emit("identity", data.id);
        if (data.type === "lobby")
          this.emit("lobby", { ...data, host: false, code: this.code });
        if (data.type === "state") this.emit("state", data.state);
        if (data.type === "presence") this.emit("presence", data.members);
        if (data.type === "error") this.emit("error", data.message);
      });
      c.on("close", () => {
        clearTimeout(timeout);
        this.emit(
          "error",
          "A conexão com o anfitrião foi encerrada. Entre novamente com o mesmo navegador para recuperar seu lugar.",
        );
      });
      c.on("error", () =>
        this.emit("error", "Não foi possível conectar à sala."),
      );
    });
  }
  publicMembers() {
    return this.members.map(({ id, name, online }) => ({ id, name, online }));
  }
  broadcast() {
    const members = this.publicMembers();
    for (const m of this.members) {
      const c = this.connections.get(m.token);
      if (!c?.open) continue;
      if (this.state) {
        c.send({ type: "state", state: viewFor(this.state, m.id) });
        c.send({ type: "presence", members });
      } else c.send({ type: "lobby", members });
    }
    if (!this.state)
      this.emit("lobby", { code: this.code, members, host: true });
    else this.emit("presence", members);
  }
  sync(s) {
    this.state = s;
    this.broadcast();
  }
  send(action) {
    if (!this.connection?.open) throw Error("Sem conexão com o anfitrião.");
    this.connection.send({ type: "action", action });
  }
  close() {
    this.closed = true;
    this.peer?.destroy();
  }
}
