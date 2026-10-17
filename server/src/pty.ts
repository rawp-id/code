import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Session = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
};

export type PtyMode = "node-pty" | "python" | "pipe";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY_HELPER = path.resolve(HERE, "..", "pty-helper.py");

let ptyModule: any;
let ptyLoaded = false;
let pythonAvailable: boolean | undefined;

/**
 * node-pty is an optional native dependency. When it is unavailable we try a
 * Python pty bridge (real echo/prompt, no native build) and finally fall back to
 * a plain child process (output only, no echo).
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

function hasPython(): boolean {
  if (pythonAvailable !== undefined) return pythonAvailable;
  try {
    pythonAvailable =
      spawnSync("python3", ["-c", "import pty"], { stdio: "ignore" }).status === 0;
  } catch {
    pythonAvailable = false;
  }
  return pythonAvailable;
}

function defaultShell(): string {
  if (process.env.SHELL) return process.env.SHELL;
  return process.platform === "win32" ? "powershell.exe" : "bash";
}

export class PtyManager {
  private sessions = new Map<string, Session>();
  mode: PtyMode = "pipe";

  get ptyAvailable(): boolean {
    return this.mode !== "pipe";
  }

  /** Determine which pty backend is available without spawning a shell. */
  async probe(): Promise<PtyMode> {
    if (await loadPty()) this.mode = "node-pty";
    else if (hasPython()) this.mode = "python";
    else this.mode = "pipe";
    return this.mode;
  }

  async spawn(
    opts: { cols: number; rows: number; shell?: string; cwd?: string },
    onData: (id: string, data: string) => void,
    onExit: (id: string, code: number) => void
  ): Promise<string> {
    const id = randomUUID();
    const shell = opts.shell || defaultShell();
    const cwd = opts.cwd || process.cwd();
    const cols = opts.cols || 80;
    const rows = opts.rows || 24;
    const env = { ...process.env, TERM: "xterm-256color" };

    const pty = await loadPty();
    if (pty) {
      this.mode = "node-pty";
      const proc = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env,
      });
      proc.onData((data: string) => onData(id, data));
      proc.onExit(({ exitCode }: { exitCode: number }) => {
        this.sessions.delete(id);
        onExit(id, exitCode);
      });
      this.sessions.set(id, {
        write: (data) => proc.write(data),
        resize: (c, r) => {
          try {
            proc.resize(c, r);
          } catch {
            /* ignore */
          }
        },
        kill: () => proc.kill(),
      });
      return id;
    }

    if (hasPython()) {
      this.mode = "python";
      const child = spawn("python3", [PY_HELPER, String(cols), String(rows)], {
        cwd,
        env,
        stdio: "pipe",
      });
      this.wireChild(id, child, onData, onExit);
      this.sessions.set(id, {
        write: (data) => child.stdin?.write(data),
        resize: () => undefined, // the pty size is fixed for this helper
        kill: () => child.kill(),
      });
      return id;
    }

    this.mode = "pipe";
    const child = spawn(shell, [], { cwd, env, stdio: "pipe" });
    this.wireChild(id, child, onData, onExit);
    this.sessions.set(id, {
      write: (data) => child.stdin?.write(data),
      resize: () => undefined,
      kill: () => child.kill(),
    });
    return id;
  }

  private wireChild(
    id: string,
    child: ChildProcess,
    onData: (id: string, data: string) => void,
    onExit: (id: string, code: number) => void
  ): void {
    child.stdout?.on("data", (data) => onData(id, data.toString()));
    child.stderr?.on("data", (data) => onData(id, data.toString()));
    child.on("error", () => {
      this.sessions.delete(id);
      onExit(id, 1);
    });
    child.on("exit", (code) => {
      this.sessions.delete(id);
      onExit(id, code ?? 0);
    });
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
