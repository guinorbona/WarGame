import { createRelayServer } from "../server/index.js";
createRelayServer({ allowedOrigins: ["http://127.0.0.1:5174"] }).server.listen(
  9002,
  "127.0.0.1",
);
