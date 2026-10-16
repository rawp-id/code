import { defineConfig } from "vite";
import os from "node:os";

// Some sandboxes block `uv_interface_addresses`, which makes Vite's LAN URL
// resolver throw. Only patch when the call actually fails; on normal machines
// this is left untouched so the LAN URL still prints.
try {
  os.networkInterfaces();
} catch {
  (os as any).networkInterfaces = () => ({});
}

const devHost = process.env.VITE_DEV_HOST || "127.0.0.1";

export default defineConfig({
  server: {
    host: devHost,
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
