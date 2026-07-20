import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export const GENERATED_WATCH_IGNORES = [
  "**/src-tauri/target/**",
  "**/.cargo-target-validation/**",
  "**/.e2e-target/**",
  "**/e2e-results/**",
  "**/logs/**",
];

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: GENERATED_WATCH_IGNORES,
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
