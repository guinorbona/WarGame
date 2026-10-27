import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174",
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/relay-server.js",
      url: "http://127.0.0.1:9002/health",
      reuseExistingServer: false,
    },
    {
      command: "node tests/peer-server.js",
      url: "http://127.0.0.1:9001",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 5174",
      url: "http://127.0.0.1:5174",
      env: {
        VITE_PEER_HOST: "127.0.0.1",
        VITE_PEER_PORT: "9001",
        VITE_PEER_SECURE: "false",
        VITE_PEER_ICE_SERVERS: "[]",
      },
      reuseExistingServer: false,
    },
  ],
});
