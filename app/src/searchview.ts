import { bridge, resolveAssetUrl } from "./bridge";
import { icons, fileColor, iconFor } from "./icons";
import { languageIdFor } from "./lang";

interface SearchMatch {
  line: number;
  column: number;
  endColumn: number;
  text: string;
}

interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
}

interface SearchResult {
  files: SearchFileResult[];
  matchCount: number;
  truncated: boolean;
}

type Flag = "case" | "regex" | "word";

export class SearchView {
  private input: HTMLInputElement;
  private summaryEl: HTMLElement;
  private resultsEl: HTMLElement;
  private timer: number | undefined;
  private flags: Record<Flag, boolean> = { case: false, regex: false, word: false };

  constructor(
    private el: HTMLElement,
    private onOpen: (path: string, line: number, column: number) => void
  ) {
    this.el.innerHTML = `
      <div class="search-view">
        <div class="search-inputs">
          <input type="text" spellcheck="false" placeholder="Search" data-search-input />
          <div class="search-flags">
            <button class="search-flag" data-flag="case" title="Match Case">Aa</button>
            <button class="search-flag" data-flag="regex" title="Use Regular Expression">.*</button>
            <button class="search-flag" data-flag="word" title="Match Whole Word">ab</button>
          </div>
        </div>
        <div class="search-summary" data-search-summary></div>
        <div class="search-results" data-search-results></div>
      </div>
    `;
    this.input = this.el.querySelector<HTMLInputElement>("[data-search-input]")!;
    this.summaryEl = this.el.querySelector<HTMLElement>("[data-search-summary]")!;
    this.resultsEl = this.el.querySelector<HTMLElement>("[data-search-results]")!;

    this.input.addEventListener("input", () => this.schedule());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        window.clearTimeout(this.timer);
        this.run();
      }
    });

    for (const button of this.el.querySelectorAll<HTMLButtonElement>("[data-flag]")) {
      button.addEventListener("click", () => {
        const flag = button.dataset.flag as Flag;
        this.flags[flag] = !this.flags[flag];
        button.classList.toggle("active", this.flags[flag]);
        void this.run();
      });
    }
  }

  focus(): void {
    this.input.focus();
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.run(), 250);
  }

  private async run(): Promise<void> {
    const query = this.input.value;
    if (!query) {
      this.resultsEl.innerHTML = "";
      this.summaryEl.textContent = "";
      return;
    }
    this.summaryEl.textContent = "Searching…";
    try {
      const result = await bridge.request<SearchResult>("ws.search", {
        query,
        caseSensitive: this.flags.case,
        regex: this.flags.regex,
        wholeWord: this.flags.word,
      });
      if (this.input.value !== query) return; // a newer query is in flight
      this.render(result);
    } catch (error: any) {
      this.summaryEl.textContent = `Search failed: ${error?.message}`;
      this.resultsEl.innerHTML = "";
    }
  }

  private fileIcon(path: string): HTMLElement {
    const icon = document.createElement("span");
    icon.className = "search-file-icon";
    const name = path.split("/").pop() || path;
    const themed = iconFor(name, "file", false, languageIdFor(path));
    if (themed) {
      const src = resolveAssetUrl(themed);
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        icon.append(img);
        return icon;
      }
    }
    icon.innerHTML = icons.file;
    icon.style.color = fileColor(name);
    return icon;
  }

  private render(result: SearchResult): void {
    this.resultsEl.innerHTML = "";
    this.summaryEl.textContent =
      result.matchCount === 0
        ? "No results"
        : `${result.matchCount} result${result.matchCount === 1 ? "" : "s"} in ` +
          `${result.files.length} file${result.files.length === 1 ? "" : "s"}` +
          `${result.truncated ? " (truncated)" : ""}`;

    for (const file of result.files) {
      const group = document.createElement("div");
      group.className = "search-file";

      const header = document.createElement("div");
      header.className = "search-file-header";
      header.title = file.path;

      const name = document.createElement("span");
      name.className = "search-file-name";
      name.textContent = file.path.split("/").pop() || file.path;

      const dir = document.createElement("span");
      dir.className = "search-file-dir";
      const slash = file.path.lastIndexOf("/");
      dir.textContent = slash >= 0 ? file.path.slice(0, slash) : "";

      const count = document.createElement("span");
      count.className = "search-file-count";
      count.textContent = String(file.matches.length);

      header.append(this.fileIcon(file.path), name, dir, count);
      header.onclick = () =>
        this.onOpen(file.path, file.matches[0].line, file.matches[0].column);
      group.append(header);

      for (const match of file.matches) {
        const row = document.createElement("div");
        row.className = "search-match";
        const lineNo = document.createElement("span");
        lineNo.className = "search-line";
        lineNo.textContent = String(match.line);
        const text = document.createElement("span");
        text.className = "search-text";
        this.highlight(text, match.text, match.column, match.endColumn);
        row.append(lineNo, text);
        row.onclick = () => this.onOpen(file.path, match.line, match.column);
        group.append(row);
      }
      this.resultsEl.append(group);
    }
  }

  private highlight(container: HTMLElement, text: string, start: number, end: number): void {
    const before = text.slice(0, Math.max(0, start));
    const match = text.slice(Math.max(0, start), Math.max(start, end));
    const after = text.slice(Math.max(start, end));
    if (before) container.append(document.createTextNode(before));
    if (match) {
      const mark = document.createElement("mark");
      mark.textContent = match;
      container.append(mark);
    }
    if (after) container.append(document.createTextNode(after));
  }
}
