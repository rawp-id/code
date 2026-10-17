export interface DirEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

export interface ExtensionInfo {
  id: string;
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  dir: string;
  active: boolean;
  runtime: boolean;
  disabled: boolean;
  icon?: string;
  commands: { command: string; title: string }[];
}

export interface ServerInfo {
  workspace: { root: string; name: string };
  pty: boolean;
  ptyMode?: "node-pty" | "python" | "pipe";
  node: string;
  platform: string;
}

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

type RequestHandler = (params: any) => any;

const STORAGE_KEY = "kode.serverUrl";

function resolveDefaultUrl(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
  } catch {
    /* storage unavailable */
  }
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  return `ws://${location.hostname || "localhost"}:3177/ws`;
}

/**
 * WebSocket bridge to the Node server. The protocol is symmetric:
 *   request:  { id, method, params }
 *   response: { id, result | error }
 *   event:    { event, data }
 *
 * The server address can be changed at runtime (`setUrl`) and is persisted, so
 * the Android build can point at an on-device or LAN server without rebuilding.
 */
export class Bridge {
  serverUrl: string;
  connected = false;

  private ws: WebSocket | null = null;
  private pending = new Map<number, Pending>();
  private events = new Map<string, Set<(data: any) => void>>();
  private handlers = new Map<string, RequestHandler>();
  private queue: string[] = [];
  private seq = 1;
  private reconnectDelay = 500;
  private reconnectTimer: number | undefined;

  constructor(url?: string) {
    this.serverUrl = url || resolveDefaultUrl();
  }

  connect(): void {
    this.open();
  }

  setUrl(url: string): void {
    this.serverUrl = url;
    try {
      localStorage.setItem(STORAGE_KEY, url);
    } catch {
      /* storage unavailable */
    }
    this.reconnectDelay = 500;
    this.open();
  }

  handleRequest(method: string, handler: RequestHandler): void {
    this.handlers.set(method, handler);
  }

  request<T = any>(method: string, params?: any, timeoutMs = 60000): Promise<T> {
    const id = this.seq++;
    const message = JSON.stringify({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (this.connected && this.ws) this.ws.send(message);
      else this.queue.push(message);
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`Request timed out: ${method}`));
      }, timeoutMs);
    });
  }

  on(event: string, listener: (data: any) => void): () => void {
    let set = this.events.get(event);
    if (!set) {
      set = new Set();
      this.events.set(event, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  private open(): void {
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.closeSocket();
    this.connected = false;
    this.emit("status", { connected: false, url: this.serverUrl });

    const ws = new WebSocket(this.serverUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 500;
      for (const message of this.queue.splice(0)) ws.send(message);
      this.emit("status", { connected: true, url: this.serverUrl });
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.connected = false;
      this.emit("status", { connected: false, url: this.serverUrl });
      this.reconnectTimer = window.setTimeout(() => this.open(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 5000);
    };

    ws.onerror = () => {
      /* close handler drives reconnection */
    };

    ws.onmessage = (event) => this.onMessage(event.data);
  }

  private closeSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
  }

  private emit(event: string, data?: any): void {
    this.events.get(event)?.forEach((listener) => listener(data));
  }

  private onMessage(raw: string): void {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.event) {
      this.emit(message.event, message.data);
      return;
    }

    if (typeof message.id === "number") {
      if (message.method) {
        const handler = this.handlers.get(message.method);
        Promise.resolve(handler ? handler(message.params || {}) : undefined).then(
          (result) => this.ws?.send(JSON.stringify({ id: message.id, result: result ?? null })),
          (error) =>
            this.ws?.send(
              JSON.stringify({
                id: message.id,
                error: { message: error?.message ? String(error.message) : String(error) },
              })
            )
        );
      } else {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
    }
  }
}

export const bridge = new Bridge();

/** HTTP origin of the server (for extension assets). */
export function httpBase(): string {
  return bridge.serverUrl.replace(/^ws/, "http").replace(/\/ws$/, "");
}
