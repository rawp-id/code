import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.kode.editor",
  appName: "Kode",
  webDir: "dist",
  server: {
    // `http` keeps `ws://` connections to an on-device server from being
    // blocked as mixed content. Switch to `https`/`wss` once TLS is available.
    androidScheme: "http",
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
