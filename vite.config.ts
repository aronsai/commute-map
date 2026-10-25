import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/commute-map/",
  plugins: [react()],
  test: { include: ["src/**/*.test.ts"] },
});
