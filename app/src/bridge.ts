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
  commands: { command: string; title: string }[];
}

export interface ServerInfo {
  workspace: { root: string; name: string };
  pty: boolean;
  node: string;
  platform: string;
}

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

type RequestHandler = (params: any) => any;

/**
 * WebSocket bridge to the Node server. The protocol is symmetric:
 *   request:  { id, method, params }
 *   response: { id, result | error }
 *   event:    { event, data }
 */
export class Bridge {
  private ws: WebSocket | null = null;
  private pending = new Map<number, Pending>();
  private events = new Map<string, Set<(data: any) => void>>();
  private handlers = new Map<string, RequestHandler>();
  private queue: string[] = [];
  private seq = 1;
  private reconnectDelay = 500;

  connected = false;

  constructor(private url: string) {}

  connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 500;
      for (const message of this.queue.splice(0)) ws.send(message);
      this.emit("status", { connected: true });
    };

    ws.onclose = () => {
      this.connected = false;
      this.emit("status", { connected: false });
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 5000);
    };

    ws.onerror = () => {
      /* close handler drives reconnection */
    };

    ws.onmessage = (event) => this.onMessage(event.data);
  }

  handleRequest(method: string, handler: RequestHandler): void {
    this.handlers.set(method, handler);
  }

  request<T = any>(method: string, params?: any): Promise<T> {
    const id = this.seq++;
    const message = JSON.stringify({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (this.connected && this.ws) this.ws.send(message);
      else this.queue.push(message);
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`Request timed out: ${method}`));
      }, 60000);
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

const defaultUrl =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ||
  `ws://${location.hostname || "localhost"}:3177/ws`;

export const bridge = new Bridge(defaultUrl);
