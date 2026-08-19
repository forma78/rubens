import type { NextConfig } from "next";

// Deliberately no turbopack.root override here. A local build warned about
// the repo root's sibling package-lock.json and setting turbopack.root
// silenced it — but Vercel's own build logs (2026-08-20) never showed that
// warning at all, meaning Vercel's build environment doesn't have that
// sibling-lockfile situation to begin with (Root Directory already scopes
// it to this folder). The override was solving a problem that only
// existed locally, and having it in place turned every production
// deployment into an edge-level 404 despite a "successful" Next.js build —
// so it's gone rather than fought with further.
const nextConfig: NextConfig = {};

export default nextConfig;
