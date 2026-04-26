import type { NextConfig } from "next";

// Bundle analyzer (#E15). Opt-in: `ANALYZE=true npm run build` opens an
// interactive treemap of every chunk in dist/. Free in CI, no runtime
// cost since the wrapper is a no-op when ANALYZE isn't set.
//
// Install on first use:
//   cd packages/frontend && npm i -D @next/bundle-analyzer
function wrapWithAnalyzer(cfg: NextConfig): NextConfig {
  if (process.env.ANALYZE !== "true") return cfg;
  try {
    // Lazy-require so a missing dep doesn't break normal builds.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const withBundleAnalyzer = require("@next/bundle-analyzer")({ enabled: true });
    return withBundleAnalyzer(cfg);
  } catch {
    console.warn(
      "[next.config] ANALYZE=true was set but @next/bundle-analyzer is not installed. Run: npm i -D @next/bundle-analyzer"
    );
    return cfg;
  }
}

const nextConfig: NextConfig = {
  // Output standalone build for smaller deployments
  output: "standalone",

  // Rewrite /api calls to the backend in production
  // This avoids CORS issues by proxying through the Next.js server
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },

  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default wrapWithAnalyzer(nextConfig);
