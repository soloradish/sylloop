import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Options } from "@wdio/types";

const root = path.dirname(fileURLToPath(import.meta.url));
const defaultBinary = path.join(root, ".e2e-target", "debug", "sylloop.exe");
const application = path.resolve(process.env.SYLLOOP_E2E_BINARY ?? defaultBinary);

export const config: Options.Testrunner = {
  runner: "local",
  specs: ["./e2e/specs/**/*.e2e.ts"],
  maxInstances: 1,
  services: [["@wdio/tauri-service", {
    appBinaryPath: application,
    driverProvider: "embedded",
    autoDownloadEdgeDriver: true,
    captureBackendLogs: true,
    captureFrontendLogs: true,
    logDir: "./e2e-results",
    startTimeout: 90_000,
    statusPollTimeout: 10_000,
    clearMocks: true,
  }]],
  capabilities: [{
    browserName: "tauri",
    "tauri:options": { application },
  }],
  logLevel: "info",
  bail: 0,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 90_000 },
  onPrepare: () => {
    fs.mkdirSync(path.join(root, "e2e-results"), { recursive: true });
  },
  afterTest: async (_test, _context, result) => {
    if (!result.passed) {
      await browser.saveScreenshot(path.join(root, "e2e-results", `failure-${Date.now()}.png`));
    }
  },
};
