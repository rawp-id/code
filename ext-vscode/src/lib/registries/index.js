import { openVsx } from "./openvsx.js";
import { vscode } from "./vscode.js";

const REGISTRIES = [openVsx, vscode];

export function listRegistries() {
  return REGISTRIES.map(({ id, label, homepage, sorts }) => ({ id, label, homepage, sorts }));
}

export function getRegistry(id) {
  return REGISTRIES.find((registry) => registry.id === id) || openVsx;
}

export { openVsx, vscode };
