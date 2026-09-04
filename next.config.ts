import type { NextConfig } from "next";

// Next 16 no longer runs ESLint as part of `next build` (it dropped the
// `eslint` config key) — linting is `npm run lint`, run explicitly and in
// CI, not implicitly during build.
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
