import http from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

// Only relays channel frames. The host still validates the game and filters snapshots.
export function createRelayServer({
  allowedOrigins = ["https://guinorbona.github.io"],
  maxClients = 500,
} = {}) {
  const peers = new Map(),
    links = new Map();
  const server = http.createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.writeHead(req.url === "/health" ? 200 : 404);
    res.end(
      JSON.stringify(
        req.url === "/health" ? { ok: true } : { error: "Not found" },
      ),
    );
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    if (
      req.url !== "/relay" ||
      !allowedOrigins.includes(req.headers.origin) ||
      wss.clients.size >= maxClients
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  const send = (ws, data) => {
    if (ws?.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 256 * 1024) {
        ws.close(1013, "Slow connection");
        return;
      }
      ws.send(JSON.stringify(data));
    }
  };
  const unlink = (id) => {
    const link = links.get(id);
    if (!link) return;
    links.delete(id);
    for (const p of [link.a, link.b]) {
      p.links.delete(id);
      send(p, { type: "closed", connectionId: id });
    }
  };
  wss.on("connection", (ws) => {
    ws.links = new Set();
    ws.alive = true;
    ws.rateAt = Date.now();
    ws.rateCount = 0;
    const registration = setTimeout(() => {
      if (!ws.id) ws.close(1008, "Registration required");
    }, 10000);
    ws.on("pong", () => {
      ws.alive = true;
    });
    ws.on("error", () => {});
    ws.on("message", (raw, binary) => {
      if (binary) {
        ws.close(1003, "JSON only");
        return;
      }
      if (Date.now() - ws.rateAt > 1000) {
        ws.rateAt = Date.now();
        ws.rateCount = 0;
      }
      if (++ws.rateCount > 120) {
        ws.close(1008, "Rate limit");
        return;
      }
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(1008, "Invalid JSON");
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (!ws.id) {
        if (
          msg.type !== "register" ||
          typeof msg.id !== "string" ||
          !/^(war-mesa-[a-f0-9]{10}|[a-f0-9-]{36})$/.test(msg.id)
        ) {
          ws.close(1008, "Invalid identity");
          return;
        }
        if (peers.has(msg.id)) {
          send(ws, { type: "error", code: "unavailable-id" });
          ws.close(1008, "Identity in use");
          return;
        }
        ws.id = msg.id;
        peers.set(ws.id, ws);
        clearTimeout(registration);
        send(ws, { type: "registered", id: ws.id });
        return;
      }
      if (msg.type === "connect") {
        const host = peers.get(msg.to),
          cid = msg.connectionId;
        if (
          typeof cid !== "string" ||
          !/^[a-f0-9-]{36}$/.test(cid) ||
          links.has(cid) ||
          ws.id.startsWith("war-mesa-") ||
          !/^war-mesa-[a-f0-9]{10}$/.test(msg.to || "")
        )
          return;
        if (!host) {
          send(ws, {
            type: "error",
            code: "peer-unavailable",
            connectionId: cid,
          });
          return;
        }
        if (host.links.size >= 5 || ws.links.size) {
          send(ws, { type: "error", code: "room-full", connectionId: cid });
          return;
        }
        links.set(cid, { a: ws, b: host });
        ws.links.add(cid);
        host.links.add(cid);
        send(host, { type: "incoming", from: ws.id, connectionId: cid });
        send(ws, { type: "connected", connectionId: cid });
        return;
      }
      const link = links.get(msg.connectionId);
      if (!link || ![link.a, link.b].includes(ws)) return;
      if (msg.type === "data")
        send(link.a === ws ? link.b : link.a, {
          type: "data",
          connectionId: msg.connectionId,
          data: msg.data,
        });
      if (msg.type === "disconnect") unlink(msg.connectionId);
    });
    ws.on("close", () => {
      clearTimeout(registration);
      if (peers.get(ws.id) === ws) peers.delete(ws.id);
      for (const id of [...ws.links]) unlink(id);
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 30000);
  heartbeat.unref();
  return {
    server,
    wss,
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS || "https://guinorbona.github.io"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const relay = createRelayServer({ allowedOrigins });
  relay.server.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
    console.log("WAR room relay listening."),
  );
  const stop = () => relay.close().then(() => process.exit(0));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
