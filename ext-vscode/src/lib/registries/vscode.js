import { fetchJson, fetchText } from "../http.js";

const QUERY_URL = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
const FLAGS = 0x200 | 0x2 | 0x1 | 0x4 | 0x10 | 0x80 | 0x100; // versions, files, categories, statistics...

const SORT = {
  relevance: [0, 0],
  installs: [4, 2],
  rating: [6, 2],
  updated: [1, 2],
  name: [0, 0],
};

const ASSETS = {
  readme: "Microsoft.VisualStudio.Services.Content.Details",
  changelog: "Microsoft.VisualStudio.Services.Content.Changelog",
  icon: "Microsoft.VisualStudio.Services.Icons.Default",
  manifest: "Microsoft.VisualStudio.Code.Manifest",
  vsix: "Microsoft.VisualStudio.Services.VSIXPackage",
};

export const vscode = {
  id: "vscode",
  label: "VS Code Marketplace",
  homepage: "https://marketplace.visualstudio.com",
  sorts: Object.keys(SORT),

  async search({ query = "", page = 1, pageSize = 24, sort = "relevance", category = "" } = {}) {
    const criteria = [{ filterType: 8, value: "Microsoft.VisualStudio.Code" }];
    if (query) criteria.push({ filterType: 10, value: query });
    if (category) criteria.push({ filterType: 5, value: category });

    const [sortBy, sortOrder] = SORT[sort] || SORT.relevance;
    const body = {
      filters: [{ criteria, pageNumber: page, pageSize, sortBy, sortOrder }],
      assetTypes: [],
      flags: FLAGS,
    };

    const data = await queryApi(body);
    const result = data.results?.[0] || {};
    const total =
      result.resultMetadata
        ?.find((meta) => meta.metadataType === "ResultCount")
        ?.metadataItems?.find((item) => item.name === "TotalCount")?.count || 0;
    const categories = (result.resultMetadata?.find((m) => m.metadataType === "Categories")?.metadataItems || []).map(
      (item) => item.name,
    );

    return {
      total,
      categories,
      items: (result.extensions || []).map((ext) => normalizeSummary(ext)),
    };
  },

  async detail(reference) {
    if (reference.raw && reference.raw.versions) return normalizeDetail(reference.raw);
    const body = {
      filters: [
        {
          criteria: [
            { filterType: 8, value: "Microsoft.VisualStudio.Code" },
            { filterType: 4, value: `${reference.namespace}.${reference.name}` },
          ],
          pageNumber: 1,
          pageSize: 1,
        },
      ],
      flags: FLAGS,
    };
    const data = await queryApi(body);
    const ext = data.results?.[0]?.extensions?.[0];
    if (!ext) throw new Error(`Extension not found: ${reference.namespace}.${reference.name}`);
    return normalizeDetail(ext);
  },

  async manifest(detail) {
    const url = detail.manifestUrl || asset(detail.raw, "manifest");
    if (!url) return null;
    return fetchJson(url);
  },

  async readme(detail) {
    const url = detail.readmeUrl || asset(detail.raw, "readme");
    if (!url) return "";
    return fetchText(url).catch(() => "");
  },

  async changelog(detail) {
    const url = detail.changelogUrl || asset(detail.raw, "changelog");
    if (!url) return "";
    return fetchText(url).catch(() => "");
  },
};

async function queryApi(body) {
  return fetchJson(QUERY_URL, {
    method: "POST",
    headers: {
      Accept: "application/json;api-version=3.0-preview.1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    timeout: 30_000,
  });
}

function asset(raw, key) {
  const files = raw?.versions?.[0]?.files || [];
  return files.find((file) => file.assetType === ASSETS[key])?.source || "";
}

function stat(ext, name) {
  return ext.statistics?.find((entry) => entry.statisticName === name)?.value || 0;
}

function normalizeSummary(ext) {
  const publisher = ext.publisher || {};
  return {
    source: "vscode",
    namespace: publisher.publisherName,
    publisher: publisher.publisherName,
    name: ext.extensionName,
    id: `${publisher.publisherName}.${ext.extensionName}`,
    displayName: ext.displayName || ext.extensionName,
    description: ext.shortDescription || "",
    version: ext.versions?.[0]?.version || "",
    iconUrl: asset(ext, "icon"),
    downloadCount: stat(ext, "install") || stat(ext, "downloadCount"),
    rating: stat(ext, "averagerating"),
    ratingCount: stat(ext, "ratingcount"),
    verified: String(publisher.flags || "").includes("verified"),
    deprecated: false,
    published: ext.publishedDate || "",
    updated: ext.lastUpdated || "",
    categories: [],
    preview: false,
    raw: ext,
  };
}

function normalizeDetail(ext) {
  const summary = normalizeSummary(ext);
  const version = ext.versions?.[0] || {};
  return {
    ...summary,
    readmeUrl: asset(ext, "readme"),
    changelogUrl: asset(ext, "changelog"),
    manifestUrl: asset(ext, "manifest"),
    downloadUrl: asset(ext, "vsix"),
    repository: "",
    license: "See extension package",
    engines: {},
    versions: (ext.versions || []).map((v) => v.version),
    raw: ext,
  };
}
