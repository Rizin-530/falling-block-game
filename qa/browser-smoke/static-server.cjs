const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const host = "127.0.0.1";
const port = Number(process.env.SMOKE_PORT || 4173);
const root = path.resolve(__dirname, "../..");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function filePathFromRequest(requestUrl) {
  const pathname = new URL(requestUrl, `http://${host}:${port}`).pathname;
  const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const candidate = path.resolve(root, `.${relative}`);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

const server = http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  if (new URL(request.url, `http://${host}:${port}`).pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  let filePath;
  try {
    filePath = filePathFromRequest(request.url);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const type = contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(port, host, () => {
  console.log(`Falling Block Game smoke server: http://${host}:${port}/`);
});

function close() {
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
