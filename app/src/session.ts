export interface SessionState {
  workspaceRoot?: string;
  openDocs: string[];
  active?: string;
  activeCursor?: number;
  expanded: string[];
  sidebarView: "files" | "search" | "extensions";
  panelVisible: boolean;
  panelView: "terminal" | "output";
  /** Unsaved buffers, keyed by path (size-capped). */
  drafts: Record<string, string>;
}

const KEY = "kode.session";
const MAX_DRAFT_SIZE = 200_000;
const MAX_DRAFT_TOTAL = 1_000_000;

export function loadSession(): SessionState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionState;
    if (!Array.isArray(parsed.openDocs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(state: SessionState): void {
  try {
    let total = 0;
    const drafts: Record<string, string> = {};
    for (const [path, content] of Object.entries(state.drafts || {})) {
      if (typeof content !== "string" || content.length > MAX_DRAFT_SIZE) continue;
      total += content.length;
      if (total > MAX_DRAFT_TOTAL) break;
      drafts[path] = content;
    }
    localStorage.setItem(KEY, JSON.stringify({ ...state, drafts }));
  } catch {
    // quota exceeded or storage unavailable: drop the drafts and retry once
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...state, drafts: {} }));
    } catch {
      /* give up */
    }
  }
}
