import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    https: {
      key: fs.readFileSync(path.resolve(__dirname, "certs/dev-key.pem")),
      cert: fs.readFileSync(path.resolve(__dirname, "certs/dev-cert.pem")),
    },
  },
});