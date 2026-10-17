import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { handleConnection } from "./rpc.js";
import { serveExtensionAsset } from "./ext-assets.js";

process.on("uncaughtException", (err) => {
  console.error("[kode] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[kode] unhandledRejection:", reason);
});

const PORT = Number(process.env.PORT || 3177);
const HOST = process.env.HOST || "0.0.0.0";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSIONS_DIR = path.join(path.resolve(HERE, ".."), "extensions");

const http = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  if (url.pathname === "/ext-asset") {
    void serveExtensionAsset(
      EXTENSIONS_DIR,
      url.searchParams.get("ext") || "",
      url.searchParams.get("path") || "",
      res
    );
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http, path: "/ws" });
wss.on("connection", (ws) => {
  handleConnection(ws);
});

http.listen(PORT, HOST, () => {
  console.log(`[kode] server listening on http://${HOST}:${PORT} (ws path /ws)`);
});
