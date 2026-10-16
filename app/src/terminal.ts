import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { bridge } from "./bridge";

export class TerminalPanel {
  readonly term: Terminal;
  private fit = new FitAddon();
  private id: string | null = null;
  private started = false;

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
      if (this.id) bridge.request("pty.write", { id: this.id, data });
    });
    this.term.onResize(({ cols, rows }) => {
      if (this.id) bridge.request("pty.resize", { id: this.id, cols, rows });
    });

    bridge.on("pty.data", ({ id, data }) => {
      if (id === this.id) this.term.write(data);
    });
    bridge.on("pty.exit", ({ id, code }) => {
      if (id === this.id) {
        this.term.writeln(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m`);
        this.id = null;
        this.started = false;
      }
    });

    window.addEventListener("resize", () => this.fitNow());
  }

  async ensureStarted(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.fitNow();
    try {
      const { id } = await bridge.request<{ id: string }>("pty.spawn", {
        cols: this.term.cols || 80,
        rows: this.term.rows || 24,
      });
      this.id = id;
    } catch (error: any) {
      this.term.writeln(`\x1b[31mFailed to start terminal: ${error?.message}\x1b[0m`);
      this.started = false;
    }
  }

  fitNow(): void {
    try {
      this.fit.fit();
    } catch {
      /* host hidden */
    }
  }

  focus(): void {
    this.term.focus();
  }

  clear(): void {
    this.term.clear();
  }
}
