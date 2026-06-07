/// <reference types="vitest" />
import { defineConfig } from "vite";

export default defineConfig({
  build: { target: "es2020" },
  test: { globals: true, environment: "node" },
});
