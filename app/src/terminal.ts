import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { bridge } from "./bridge";

export class TerminalPanel {
  readonly term: Terminal;
  private fit = new FitAddon();
  private id: string | null = null;
  private startPromise: Promise<void> | null = null;
  private pending = "";
  private offline = false;

  constructor(private host: HTMLElement) {
    this.term = new Terminal({
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: "#1e1e1e",
        foreground: "#cccccc",
        cursor: "#cccccc",
      },
    });
    this.term.loadAddon(this.fit);
    this.term.open(host);

    this.term.onData((data) => {
      if (this.id) {
        this.write(data);
        return;
      }
      if (this.offline) return;
      // The shell has not started or has exited: restart lazily and replay input.
      this.pending += data;
      this.ensureStarted().then(() => {
        if (this.id && this.pending) {
          this.write(this.pending);
          this.pending = "";
        }
      });
    });

    this.term.onResize(({ cols, rows }) => {
      if (this.id) bridge.request("pty.resize", { id: this.id, cols, rows });
    });

    bridge.on("pty.data", ({ id, data }) => {
      if (id === this.id) this.term.write(data);
    });
    bridge.on("pty.exit", ({ id, code }) => {
      if (id !== this.id) return;
      this.id = null;
      this.term.writeln(
        `\r\n\x1b[90m[process exited with code ${code} — press a key to restart]\x1b[0m`
      );
    });

    bridge.on("status", ({ connected }: { connected: boolean }) => {
      if (connected && this.offline) {
        this.offline = false;
        this.term.writeln(
          "\r\n\x1b[90m[server connected — press a key to start the terminal]\x1b[0m"
        );
      }
    });

    window.addEventListener("resize", () => this.fitNow());
  }

  private write(data: string): void {
    if (this.id) bridge.request("pty.write", { id: this.id, data });
  }

  ensureStarted(): Promise<void> {
    if (this.id) return Promise.resolve();
    if (this.offline) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.doStart().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    this.fitNow();
    try {
      const { id } = await bridge.request<{ id: string }>("pty.spawn", {
        cols: this.term.cols || 80,
        rows: this.term.rows || 24,
      });
      this.id = id;
    } catch (error: any) {
      this.offline = true;
      this.term.writeln(
        `\x1b[31mFailed to start terminal: ${error?.message}\x1b[0m`
      );
      this.term.writeln(
        "\x1b[90mConnect to a Kode server from Settings → Connection to use the shell.\x1b[0m"
      );
    }
  }

  fitNow(): void {
    try {
      this.fit.fit();
    } catch {
      /* host hidden */
    }
  }

  setFontSize(size: number): void {
    if (!Number.isFinite(size) || size < 6) return;
    this.term.options.fontSize = size;
    this.fitNow();
  }

  focus(): void {
    this.term.focus();
  }

  clear(): void {
    this.term.clear();
  }
}
