import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vinextBin = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vinext.cmd" : "vinext",
);

const env = {
  ...process.env,
  WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
};

const scanner = spawn(
  process.execPath,
  ["scripts/scan-server.mjs"],
  {
    env,
    stdio: ["ignore", "inherit", "inherit"],
  },
);

const site = spawn(vinextBin, ["dev"], {
  env,
  stdio: "inherit",
});

function stopAll(signal) {
  scanner.kill(signal);
  site.kill(signal);
}

site.on("exit", (code, signal) => {
  scanner.kill("SIGTERM");
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
