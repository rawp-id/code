/** Persistent plugin state, stored in the plugin cache file. */

const DEFAULTS = {
  source: "openvsx",
  sort: "relevance",
  pageSize: 20,
  autoActivate: true,
  hideUnsupported: false,
  installed: {},
  recentSearches: [],
  lspEnabled: {},
};

export const store = {
  data: { ...DEFAULTS },
  file: null,

  async load(cacheFile) {
    this.file = cacheFile;
    try {
      const parsed = await cacheFile.readFile("json");
      this.data = { ...DEFAULTS, ...(parsed || {}) };
    } catch {
      this.data = { ...DEFAULTS };
    }
    return this.data;
  },

  async save() {
    if (!this.file) return;
    try {
      await this.file.writeFile(JSON.stringify(this.data));
    } catch {
      /* ignore quota / io errors */
    }
  },

  get(key) {
    return this.data[key];
  },

  async set(key, value) {
    this.data[key] = value;
    await this.save();
  },

  isInstalled(id) {
    return Boolean(this.data.installed[id]);
  },

  async markInstalled(record) {
    this.data.installed[record.id] = record;
    await this.save();
  },

  async unmarkInstalled(id) {
    delete this.data.installed[id];
    await this.save();
  },

  async addRecent(query) {
    const term = String(query || "").trim();
    if (!term) return;
    const list = this.data.recentSearches.filter((item) => item !== term);
    list.unshift(term);
    this.data.recentSearches = list.slice(0, 8);
    await this.save();
  },

  reset() {
    this.data = { ...DEFAULTS, installed: this.data.installed };
    return this.save();
  },
};
