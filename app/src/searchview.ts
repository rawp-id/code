import { bridge } from "./bridge";

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

export class SearchView {
  private input: HTMLInputElement;
  private caseEl: HTMLInputElement;
  private regexEl: HTMLInputElement;
  private wordEl: HTMLInputElement;
  private summaryEl: HTMLElement;
  private resultsEl: HTMLElement;
  private timer: number | undefined;

  constructor(
    private el: HTMLElement,
    private onOpen: (path: string, line: number, column: number) => void
  ) {
    this.el.innerHTML = `
      <div class="search-view">
        <div class="search-inputs">
          <input type="text" spellcheck="false" placeholder="Search" data-search-input />
          <div class="search-flags">
            <label title="Match case"><input type="checkbox" data-search-case />Aa</label>
            <label title="Use regular expression"><input type="checkbox" data-search-regex />.*</label>
            <label title="Match whole word"><input type="checkbox" data-search-word />ab</label>
          </div>
        </div>
        <div class="search-summary" data-search-summary></div>
        <div class="search-results" data-search-results></div>
      </div>
    `;
    this.input = this.el.querySelector<HTMLInputElement>("[data-search-input]")!;
    this.caseEl = this.el.querySelector<HTMLInputElement>("[data-search-case]")!;
    this.regexEl = this.el.querySelector<HTMLInputElement>("[data-search-regex]")!;
    this.wordEl = this.el.querySelector<HTMLInputElement>("[data-search-word]")!;
    this.summaryEl = this.el.querySelector<HTMLElement>("[data-search-summary]")!;
    this.resultsEl = this.el.querySelector<HTMLElement>("[data-search-results]")!;

    this.input.addEventListener("input", () => this.schedule());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        window.clearTimeout(this.timer);
        this.run();
      }
    });
    for (const box of [this.caseEl, this.regexEl, this.wordEl]) {
      box.addEventListener("change", () => this.run());
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
        caseSensitive: this.caseEl.checked,
        regex: this.regexEl.checked,
        wholeWord: this.wordEl.checked,
      });
      if (this.input.value !== query) return; // a newer query is in flight
      this.render(result);
    } catch (error: any) {
      this.summaryEl.textContent = `Search failed: ${error?.message}`;
      this.resultsEl.innerHTML = "";
    }
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
      const name = document.createElement("span");
      name.className = "search-file-name";
      name.textContent = file.path;
      const count = document.createElement("span");
      count.className = "search-file-count";
      count.textContent = String(file.matches.length);
      header.append(name, count);
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
