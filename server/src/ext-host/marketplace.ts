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

const OPEN_VSX = "https://open-vsx.org/api";
const VS_MARKETPLACE =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";

export async function searchMarketplace(
  registry: Registry,
  query: string,
  size = 30,
  offset = 0
): Promise<MarketplaceSearchResult> {
  if (!query.trim()) return { extensions: [], total: 0 };
  return registry === "vscode"
    ? searchVsMarketplace(query, size, offset)
    : searchOpenVsx(query, size, offset);
}

async function searchOpenVsx(
  query: string,
  size: number,
  offset: number
): Promise<MarketplaceSearchResult> {
  const url = `${OPEN_VSX}/-/search?query=${encodeURIComponent(query)}&size=${size}&offset=${offset}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Open VSX search failed: ${response.status}`);
  const data: any = await response.json();
  const extensions: MarketplaceExtension[] = (data.extensions || []).map((item: any) => ({
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
  }));
  return { extensions, total: data.totalSize ?? extensions.length };
}

async function searchVsMarketplace(
  query: string,
  size: number,
  offset: number
): Promise<MarketplaceSearchResult> {
  const body = {
    filters: [
      {
        criteria: [{ filterType: 10, value: query }],
        pageNumber: Math.floor(offset / size) + 1,
        pageSize: size,
        sortBy: 0,
        sortOrder: 0,
      },
    ],
    assetTypes: [],
    flags: 914,
  };
  const response = await fetch(VS_MARKETPLACE, {
    method: "POST",
    headers: {
      accept: "application/json;api-version=3.0-preview.1",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`VS Code Marketplace search failed: ${response.status}`);
  const data: any = await response.json();
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
