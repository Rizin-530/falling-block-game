const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const host = "127.0.0.1";
const port = 4173;
const baseURL = `http://${host}:${port}/`;
const pidFile = path.join(__dirname, ".smoke-server.pid");

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const request = http.get(baseURL, response => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      request.on("error", retry);
      request.setTimeout(500, () => request.destroy());
    };
    const retry = () => {
      if (Date.now() - started > 15_000) reject(new Error("Smoke server did not start"));
      else setTimeout(check, 100);
    };
    check();
  });
}

module.exports = async () => {
  const server = spawn(process.execPath, [path.join(__dirname, "static-server.cjs")], {
    cwd: __dirname,
    stdio: "ignore",
    windowsHide: true,
  });
  fs.writeFileSync(pidFile, String(server.pid));
  try {
    await waitForServer();
  } catch (error) {
    server.kill();
    fs.rmSync(pidFile, { force: true });
    throw error;
  }
};
