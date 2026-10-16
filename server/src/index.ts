import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { handleConnection } from "./rpc.js";

const PORT = Number(process.env.PORT || 3177);
const HOST = process.env.HOST || "0.0.0.0";

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
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
