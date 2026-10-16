import { fetchJson, fetchText } from "../http.js";

const BASE = "https://open-vsx.org/api";

const SORT = {
  relevance: null,
  installs: ["downloadCount", "desc"],
  rating: ["averageRating", "desc"],
  updated: ["timestamp", "desc"],
  name: ["name", "asc"],
};

export const openVsx = {
  id: "openvsx",
  label: "Open VSX",
  homepage: "https://open-vsx.org",
  sorts: Object.keys(SORT),

  async search({ query = "", page = 1, pageSize = 24, sort = "relevance" } = {}) {
    const params = new URLSearchParams();
    params.set("size", String(pageSize));
    params.set("offset", String((page - 1) * pageSize));
    if (query) params.set("query", query);
    const order = SORT[sort];
    if (order) {
      params.set("sortBy", order[0]);
      params.set("sortOrder", order[1]);
    }

    const data = await fetchJson(`${BASE}/-/search?${params.toString()}`);
    return {
      total: data.totalSize || 0,
      items: (data.extensions || []).map(normalizeSummary),
    };
  },

  async detail(reference) {
    const namespace = reference.namespace || reference.raw?.namespace;
    const name = reference.name || reference.raw?.name;
    if (!namespace || !name) throw new Error("Unknown Open VSX extension");
    const data = await fetchJson(`${BASE}/${namespace}/${name}`);
    return normalizeDetail(data);
  },

  async manifest(detail) {
    const url = detail.manifestUrl || detail.raw?.files?.manifest;
    if (!url) return null;
    return fetchJson(url);
  },

  async readme(detail) {
    const url = detail.readmeUrl || detail.raw?.files?.readme;
    if (!url) return "";
    return fetchText(url).catch(() => "");
  },

  async changelog(detail) {
    const url = detail.changelogUrl || detail.raw?.files?.changelog;
    if (!url) return "";
    return fetchText(url).catch(() => "");
  },
};

function normalizeSummary(ext) {
  return {
    source: "openvsx",
    namespace: ext.namespace,
    publisher: ext.namespace,
    name: ext.name,
    id: `${ext.namespace}.${ext.name}`,
    displayName: ext.displayName || ext.name,
    description: ext.description || "",
    version: ext.version,
    iconUrl: ext.files?.icon || "",
    downloadCount: ext.downloadCount || 0,
    rating: ext.averageRating || 0,
    ratingCount: ext.reviewCount || 0,
    verified: Boolean(ext.verified),
    deprecated: Boolean(ext.deprecated),
    published: ext.timestamp || "",
    categories: ext.categories || [],
    preview: Boolean(ext.preview),
    raw: ext,
  };
}

function normalizeDetail(ext) {
  const files = ext.files || {};
  const download = files.download || ext.downloads?.universal || ext.downloads?.web || "";
  return {
    ...normalizeSummary(ext),
    readmeUrl: files.readme || "",
    changelogUrl: files.changelog || "",
    manifestUrl: files.manifest || "",
    licenseUrl: files.license || "",
    downloadUrl: download,
    downloadSize: ext.downloadCount ? 0 : 0,
    repository: ext.repository || ext.bugs || "",
    homepage: ext.homepage || "",
    license: ext.license || "",
    engines: ext.engines || {},
    dependencies: ext.dependencies || [],
    versions: Object.keys(ext.allVersions || {})
      .filter((key) => key !== "latest")
      .sort(compareVersions)
      .reverse(),
    raw: ext,
  };
}

export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}
