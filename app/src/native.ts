import { Capacitor, registerPlugin } from "@capacitor/core";

export interface KodeServerPlugin {
  isTermuxInstalled(): Promise<{ installed: boolean }>;
  startInTermux(options: { command: string; workdir?: string }): Promise<void>;
  openTermux(): Promise<void>;
}

/** Native bridge exposed by `ServerPlugin.java` (Android only). */
export const KodeServer = registerPlugin<KodeServerPlugin>("KodeServer");

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}
