const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const pidFile = path.join(__dirname, ".smoke-server.pid");

module.exports = async () => {
  if (!fs.existsSync(pidFile)) return;
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  fs.rmSync(pidFile, { force: true });
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    else process.kill(pid, "SIGTERM");
  } catch {
    // The server may already have exited after a setup failure.
  }
};
