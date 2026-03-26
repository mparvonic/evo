import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // V produkci /api/* přebírá Apache a přesměrovává na EVO-X2.
  // Pro lokální vývoj: EVO_API_URL=http://10.10.0.2:8000 npm run dev
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.EVO_API_URL || "http://10.10.0.2:8000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
