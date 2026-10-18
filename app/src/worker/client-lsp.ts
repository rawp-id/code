/**
 * Client-Side LSP Service Manager.
 *
 * Coordinates the background Web Worker language service with the CodeMirror UI.
 * Provides completions, diagnostics, and hover information completely client-side.
 */

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

export class ClientLspService {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private seq = 1;
  private diagnosticListeners = new Set<(uri: string, diagnostics: any[]) => void>();

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(new URL("./language-worker.ts", import.meta.url), {
        type: "module",
      });

      this.worker.onmessage = (event: MessageEvent) => {
        const { id, result, error, event: eventName, data } = event.data || {};

        if (eventName === "textDocument/publishDiagnostics" && data) {
          for (const listener of this.diagnosticListeners) {
            listener(data.uri, data.diagnostics || []);
          }
          return;
        }

        if (id && this.pending.has(id)) {
          const { resolve, reject } = this.pending.get(id)!;
          this.pending.delete(id);
          if (error) reject(new Error(error));
          else resolve(result);
        }
      };

      this.worker.onerror = (err) => {
        console.warn("[ClientLsp] worker error:", err);
      };
    } catch (e) {
      console.warn("[ClientLsp] Web Workers unavailable, falling back:", e);
      this.worker = null;
    }
  }

  onDiagnostics(listener: (uri: string, diagnostics: any[]) => void): () => void {
    this.diagnosticListeners.add(listener);
    return () => this.diagnosticListeners.delete(listener);
  }

  private request<T = any>(method: string, params: any, timeoutMs = 5000): Promise<T> {
    if (!this.worker) return Promise.resolve(null as any);
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, method, params });
      setTimeout(() => {
        if (this.pending.delete(id)) resolve(null as any);
      }, timeoutMs);
    });
  }

  private notify(method: string, params: any): void {
    if (!this.worker) return;
    this.worker.postMessage({ method, params });
  }

  didOpen(uri: string, languageId: string, text: string): void {
    this.notify("textDocument/didOpen", { uri, languageId, text });
  }

  didChange(uri: string, text: string): void {
    this.notify("textDocument/didChange", { uri, text });
  }

  didClose(uri: string): void {
    this.notify("textDocument/didClose", { uri });
  }

  async completion(uri: string, position: { line: number; character: number }): Promise<any[]> {
    return this.request<any[]>("textDocument/completion", { uri, position }).catch(() => []);
  }

  async hover(uri: string, position: { line: number; character: number }): Promise<any> {
    return this.request<any>("textDocument/hover", { uri, position }).catch(() => null);
  }

  /** Run a formatter (metadata lives in `formatters.ts`). */
  async format(
    providerId: string,
    text: string,
    languageId: string,
    options: any
  ): Promise<string | null> {
    const result = await this.request<{ text: string }>(
      "formatter/format",
      { providerId, text, languageId, options },
      30000
    ).catch(() => null);
    return result?.text ?? null;
  }
}

export const clientLsp = new ClientLspService();
