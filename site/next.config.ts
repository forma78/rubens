import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The repo root (one level up) has its own package-lock.json for the
  // plain-JS engine/syndicate code — pin Turbopack's root to this
  // directory so it doesn't try to treat the whole monorepo as one
  // workspace.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
