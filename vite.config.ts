import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/tiles": "http://localhost:8080",
      "/raster": "http://localhost:8080",
      "/api": "http://localhost:8080",
    },
  },
});
