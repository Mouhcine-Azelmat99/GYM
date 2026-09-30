import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({mode}) => {
  const {DEV_TUNNEL_URL}=loadEnv(mode,process.cwd(),'DEV_TUNNEL_URL');
  const allowedHosts=DEV_TUNNEL_URL?[new URL(DEV_TUNNEL_URL).hostname]:[];
  return {
  plugins: [react()],
  server: { strictPort: true, allowedHosts, proxy: { "/api": "http://127.0.0.1:4000" } },
  build: { sourcemap: false },
  };
});
