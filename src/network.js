import Peer from "peerjs";
import { RelayPeer, normalizeRelayUrl } from "./relay-peer.js";
import { viewFor } from "./engine.js";

export class Room {
  constructor(onEvent, PeerImplementation = Peer, options = {}) {
    this.options = options;
    this.relayUrl = normalizeRelayUrl(
      options.relayUrl ?? (import.meta.env || {}).VITE_RELAY_URL ?? "",
    );
    this.PeerImplementation = this.relayUrl ? RelayPeer : PeerImplementation;
    this.timers = new Set();
    this.connectionTimeout = options.connectionTimeoutMs || 60000;
    this.handshakeTimeout = options.handshakeTimeoutMs || 10000;
    this.onEvent = onEvent;
    this.connections = new Map();
    this.members = [];
    this.host = false;
    this.closed = false;
  }
  emit(type, payload) {
    if (!this.closed) this.onEvent(type, payload);
  }
  later(fn, delay) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.closed) fn();
    }, delay);
    this.timers.add(timer);
    return timer;
  }
  cancel(timer) {
    clearTimeout(timer);
    this.timers.delete(timer);
  }
  status(stage, message) {
    this.emit("status", { stage, message });
  }
  init(id) {
    this.status(
      "connecting",
      this.relayUrl ? "Conectando ao servidor da sala…" : "Localizando a sala…",
    );
    const readyDeadline = this.later(() => {
      this.status(
        "error",
        "O serviço de conexão não respondeu. Tente novamente.",
      );
      this.emit(
        "error",
        "O serviço de conexão não respondeu. Tente novamente.",
      );
      this.peer?.destroy();
    }, this.connectionTimeout);
    const env = import.meta.env || {};
    const custom = env.VITE_PEER_HOST
      ? {
          host: env.VITE_PEER_HOST,
          port: Number(env.VITE_PEER_PORT || 443),
          path: env.VITE_PEER_PATH || "/",
          secure: env.VITE_PEER_SECURE !== "false",
        }
      : {};
    const rtc =
      !this.relayUrl && env.VITE_PEER_ICE_SERVERS
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
      ...(this.relayUrl
        ? {
            relayUrl: this.relayUrl,
            WebSocketImplementation: this.options.WebSocketImplementation,
          }
        : {}),
    });
    this.peer.on("open", () => this.cancel(readyDeadline));
    this.peer.on("error", (e) => {
      this.cancel(readyDeadline);
      this.pendingJoinCancel?.();
      const messages = {
        "peer-unavailable":
          "Sala não encontrada. Confira o código e se o anfitrião está conectado ao mesmo serviço.",
        "unavailable-id":
          "Já existe uma sala com esse código. Crie outra sala.",
        "room-full": "A sala está cheia.",
        "relay-unavailable":
          "O servidor da sala não respondeu. Confira o endereço e tente novamente.",
      };
      const message =
        messages[e.type] ||
        `Falha no serviço de conexão (${e.type}). Tente novamente.`;
      this.status("error", message);
      this.emit("error", message);
    });
    this.peer.on("disconnected", () => {
      this.emit("notice", "A sinalização desconectou. Tentando reconectar…");
      if (!this.closed) {
        try {
          this.peer.reconnect();
        } catch {
          this.emit(
            "notice",
            "Não foi possível reconectar ao serviço. Tente entrar novamente.",
          );
        }
      }
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
      // Negotiating ICE is not the same as waiting for the hello message.
      let timeout = this.later(() => c.close(), this.connectionTimeout);
      const channelOpened = () => {
        this.cancel(timeout);
        timeout = this.later(() => {
          if (!member) c.close();
        }, this.handshakeTimeout);
      };
      c.on("open", channelOpened);
      if (c.open) channelOpened();
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
              this.later(() => c.close(), 200);
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
          this.cancel(timeout);
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
        this.cancel(timeout);
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
      if (this.connection?.open) return;
      this.joinFailed = false;
      this.status(
        "negotiating",
        this.relayUrl
          ? "Entrando na sala pelo servidor…"
          : "Negociando a conexão entre os aparelhos. Isso pode levar até um minuto…",
      );
      const c = this.peer.connect(`war-mesa-${this.code}`, { reliable: true });
      this.connection = c;
      let identified = false,
        helloDeadline;
      const networkMessage = this.relayUrl
        ? "O servidor não concluiu a conexão. Confira o endereço e tente novamente."
        : "A conexão direta entre essas redes não foi concluída. Use a opção Servidor de sala para conectar sem depender da rede dos aparelhos.";
      const fail = (message) => {
        this.cancel(timeout);
        this.cancel(helloDeadline);
        if (this.closed || this.joinFailed) return;
        this.joinFailed = true;
        this.status("error", message);
        this.emit("error", message);
        c.close();
      };
      const timeout = this.later(
        () => fail(networkMessage),
        this.connectionTimeout,
      );
      this.pendingJoinCancel = () => {
        this.cancel(timeout);
        this.cancel(helloDeadline);
        this.joinFailed = true;
        c.close();
      };
      c.on("open", () => {
        this.cancel(timeout);
        this.status(
          "identifying",
          "Conexão aberta. Confirmando seu lugar na sala…",
        );
        helloDeadline = this.later(
          () =>
            fail(
              "O anfitrião não confirmou sua entrada. Tente entrar novamente.",
            ),
          this.handshakeTimeout,
        );
        c.send({ type: "hello", name, token });
      });
      c.on("data", (data) => {
        if (!data || typeof data !== "object") return;
        if (
          data.type === "identity" &&
          Number.isInteger(data.id) &&
          data.id >= 0 &&
          data.id < 6
        ) {
          identified = true;
          this.pendingJoinCancel = null;
          this.cancel(timeout);
          this.cancel(helloDeadline);
          this.status("connected", "Conectado à sala.");
          this.emit("identity", data.id);
        }
        if (data.type === "lobby")
          this.emit("lobby", { ...data, host: false, code: this.code });
        if (data.type === "state") this.emit("state", data.state);
        if (data.type === "presence") this.emit("presence", data.members);
        if (data.type === "error") {
          if (!identified) fail(data.message);
          else this.emit("error", data.message);
        }
      });
      c.on("close", () =>
        fail(
          identified
            ? "A conexão com o anfitrião foi encerrada. Entre novamente com o mesmo navegador para recuperar seu lugar."
            : networkMessage,
        ),
      );
      c.on("error", () => fail(networkMessage));
      const pc = c.peerConnection;
      pc?.addEventListener("iceconnectionstatechange", () => {
        if (pc.iceConnectionState === "failed") fail(networkMessage);
      });
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
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.peer?.destroy();
  }
}
