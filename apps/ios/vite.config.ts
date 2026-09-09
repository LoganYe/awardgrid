import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Capacitor copies dist/ into ios/App/App/public and serves it from capacitor://localhost,
  // so every asset URL must be relative.
  base: "",
  build: { outDir: "dist", sourcemap: true },
});
