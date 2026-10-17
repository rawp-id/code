export type Registry = "open-vsx" | "vscode";

export interface MarketplaceExtension {
  id: string;
  namespace: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  downloads: number;
  rating: number;
  publisher: string;
  iconUrl?: string;
  downloadUrl?: string;
}

export interface MarketplaceSearchResult {
  extensions: MarketplaceExtension[];
  total: number;
}

export interface MarketplaceDetail extends MarketplaceExtension {
  readme?: string;
  changelog?: string;
  readmeIsHtml?: boolean;
  repository?: string;
  license?: string;
  categories?: string[];
}

const OPEN_VSX = "https://open-vsx.org/api";
const VS_MARKETPLACE =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";

export async function searchMarketplace(
  registry: Registry,
  query: string,
  size = 30,
  offset = 0,
  sortBy?: string,
  sortOrder?: string
): Promise<MarketplaceSearchResult> {
  if (registry === "vscode" && !query.trim()) return { extensions: [], total: 0 };
  return registry === "vscode"
    ? searchVsMarketplace(query, size, offset, sortBy)
    : searchOpenVsx(query, size, offset, sortBy, sortOrder);
}

async function searchOpenVsx(
  query: string,
  size: number,
  offset: number,
  sortBy?: string,
  sortOrder?: string
): Promise<MarketplaceSearchResult> {
  const params = new URLSearchParams({
    query,
    size: String(size),
    offset: String(offset),
  });
  if (sortBy) {
    const sortMap: Record<string, string> = {
      installs: "downloadCount",
      rating: "relevance",
      updated: "timestamp",
    };
    const value = sortMap[sortBy] ?? sortBy;
    if (value) {
      params.set("sortBy", value);
      params.set("sortOrder", sortOrder || "desc");
    }
  }
  const url = `${OPEN_VSX}/-/search?${params.toString()}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Open VSX search failed: ${response.status}`);
  const data: any = await response.json();
  const extensions: MarketplaceExtension[] = (data.extensions || []).map(normalizeOpenVsx);
  return { extensions, total: data.totalSize ?? extensions.length };
}

function normalizeOpenVsx(item: any): MarketplaceExtension {
  return {
    id: `${item.namespace}.${item.name}`,
    namespace: item.namespace,
    name: item.name,
    displayName: item.displayName || item.name,
    description: item.description || "",
    version: item.version || "",
    downloads: item.downloadCount || 0,
    rating: item.averageRating || 0,
    publisher: item.publisher?.loginName || item.namespace,
    iconUrl: item.files?.icon,
    downloadUrl: item.files?.download,
  };
}

function repositoryUrl(repository: any): string | undefined {
  if (!repository) return undefined;
  return typeof repository === "string" ? repository : repository.url;
}

/** Extra metadata + README/changelog for a marketplace extension. */
export async function getMarketplaceDetail(
  registry: Registry,
  id: string
): Promise<MarketplaceDetail> {
  const dot = id.indexOf(".");
  const namespace = dot >= 0 ? id.slice(0, dot) : id;
  const name = dot >= 0 ? id.slice(dot + 1) : "";
  return registry === "vscode"
    ? vsDetail(namespace, name)
    : openVsxDetail(namespace, name);
}

async function openVsxDetail(namespace: string, name: string): Promise<MarketplaceDetail> {
  const response = await fetch(`${OPEN_VSX}/${namespace}/${name}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Open VSX detail failed: ${response.status}`);
  const data: any = await response.json();
  const files = data.files || {};
  const readme = files.readme ? await fetchText(files.readme) : undefined;
  const changelog = files.changelog ? await fetchText(files.changelog) : undefined;
  return {
    ...normalizeOpenVsx(data),
    readme,
    changelog,
    readmeIsHtml: false,
    repository: repositoryUrl(data.repository),
    license: data.license,
    categories: data.categories,
  };
}

async function vsDetail(namespace: string, name: string): Promise<MarketplaceDetail> {
  const data = await queryVsMarketplace(
    [{ filterType: 7, value: `${namespace}.${name}` }],
    1,
    0
  );
  const item = data.results?.[0]?.extensions?.[0];
  if (!item) throw new Error(`Extension not found: ${namespace}.${name}`);
  const version = item.versions?.[0] ?? {};
  const files: any[] = version.files || [];
  const asset = (type: string) => files.find((file) => file.assetType === type)?.source;
  const readme = asset("Microsoft.VisualStudio.Services.Content.Details");
  const changelog = asset("Microsoft.VisualStudio.Services.Content.Changelog");
  return {
    id: `${item.publisher.publisherName}.${item.extensionName}`,
    namespace: item.publisher.publisherName,
    name: item.extensionName,
    displayName: item.displayName,
    description: item.shortDescription || "",
    version: version.version || "",
    downloads:
      (item.statistics || []).find((stat: any) => stat.statisticName === "install")?.value ?? 0,
    rating: item.averageRating ?? 0,
    publisher: item.publisher.displayName || item.publisher.publisherName,
    iconUrl: asset("Microsoft.VisualStudio.Services.Icons.Default"),
    downloadUrl: asset("Microsoft.VisualStudio.Services.VSIXPackage"),
    readme: readme ? await fetchText(readme) : undefined,
    changelog: changelog ? await fetchText(changelog) : undefined,
    readmeIsHtml: true,
    repository:
      (item.properties || []).find((prop: any) => prop.key === "Repo")?.value || undefined,
    license: undefined,
    categories: item.categories || [],
  };
}

async function queryVsMarketplace(
  criteria: any[],
  pageSize: number,
  offset: number,
  sortBy = 0
): Promise<any> {
  const body = {
    filters: [
      {
        criteria,
        pageNumber: Math.floor(offset / pageSize) + 1,
        pageSize,
        sortBy,
        sortOrder: 0,
      },
    ],
    assetTypes: [],
    flags: 951,
  };
  const response = await fetch(VS_MARKETPLACE, {
    method: "POST",
    headers: {
      accept: "application/json;api-version=3.0-preview.1",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`VS Code Marketplace request failed: ${response.status}`);
  return response.json();
}

async function fetchText(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: { accept: "text/plain, text/markdown, text/html, */*" },
    });
    return response.ok ? await response.text() : "";
  } catch {
    return "";
  }
}

async function searchVsMarketplace(
  query: string,
  size: number,
  offset: number,
  sortBy?: string
): Promise<MarketplaceSearchResult> {
  const sortMap: Record<string, number> = { relevance: 0, installs: 4, rating: 6, updated: 1 };
  const data = await queryVsMarketplace(
    [{ filterType: 10, value: query }],
    size,
    offset,
    sortMap[sortBy || "relevance"] ?? 0
  );
  const result = data.results?.[0];
  const extensions: MarketplaceExtension[] = (result?.extensions || []).map((item: any) => {
    const version = item.versions?.[0] ?? {};
    const files: any[] = version.files || [];
    const vsix = files.find(
      (file) => file.assetType === "Microsoft.VisualStudio.Services.VSIXPackage"
    );
    const icon = files.find((file) => /Icons/.test(file.assetType || ""));
    return {
      id: `${item.publisher.publisherName}.${item.extensionName}`,
      namespace: item.publisher.publisherName,
      name: item.extensionName,
      displayName: item.displayName,
      description: item.shortDescription || "",
      version: version.version || "",
      downloads:
        (item.statistics || []).find((stat: any) => stat.statisticName === "install")?.value ?? 0,
      rating: item.averageRating ?? 0,
      publisher: item.publisher.displayName || item.publisher.publisherName,
      iconUrl: icon?.source,
      downloadUrl: vsix?.source,
    };
  });
  return { extensions, total: result?.resultMetadata?.[0]?.totalCount ?? extensions.length };
}
