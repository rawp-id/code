import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

type Session = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
};

let ptyModule: any;
let ptyLoaded = false;

/**
 * node-pty is an optional native dependency. When it is unavailable we fall
 * back to a plain child process: no job control and no echo, but ordinary
 * commands still stream output, so the terminal panel remains usable.
 */
async function loadPty(): Promise<any> {
  if (ptyLoaded) return ptyModule;
  ptyLoaded = true;
  try {
    const mod: any = await import("node-pty");
    const resolved = mod?.default ?? mod;
    ptyModule = typeof resolved?.spawn === "function" ? resolved : null;
  } catch {
    ptyModule = null;
  }
  return ptyModule;
}

function defaultShell(): string {
  if (process.env.SHELL) return process.env.SHELL;
  return process.platform === "win32" ? "powershell.exe" : "bash";
}

export class PtyManager {
  private sessions = new Map<string, Session>();
  ptyAvailable = false;

  async spawn(
    opts: { cols: number; rows: number; shell?: string; cwd?: string },
    onData: (id: string, data: string) => void,
    onExit: (id: string, code: number) => void
  ): Promise<string> {
    const id = randomUUID();
    const shell = opts.shell || defaultShell();
    const cwd = opts.cwd || process.cwd();
    const pty = await loadPty();
    this.ptyAvailable = Boolean(pty);

    if (pty) {
      const proc = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: opts.cols || 80,
        rows: opts.rows || 24,
        cwd,
        env: { ...process.env, TERM: "xterm-256color" },
      });
      proc.onData((data: string) => onData(id, data));
      proc.onExit(({ exitCode }: { exitCode: number }) => {
        this.sessions.delete(id);
        onExit(id, exitCode);
      });
      this.sessions.set(id, {
        write: (data) => proc.write(data),
        resize: (cols, rows) => {
          try {
            proc.resize(cols, rows);
          } catch {
            /* ignore */
          }
        },
        kill: () => proc.kill(),
      });
      return id;
    }

    const child: ChildProcess = spawn(shell, [], {
      cwd,
      env: { ...process.env, TERM: "xterm-256color" },
      stdio: "pipe",
    });
    child.stdout?.on("data", (d) => onData(id, d.toString()));
    child.stderr?.on("data", (d) => onData(id, d.toString()));
    child.on("exit", (code) => {
      this.sessions.delete(id);
      onExit(id, code ?? 0);
    });
    this.sessions.set(id, {
      write: (data) => child.stdin?.write(data),
      resize: () => undefined,
      kill: () => child.kill(),
    });
    return id;
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows);
  }

  kill(id: string): void {
    this.sessions.get(id)?.kill();
    this.sessions.delete(id);
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }
}
