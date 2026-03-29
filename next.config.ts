import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Když je nastaveno EVO_API_URL, Next proxyuje backend API i v produkci.
  // To umožní provoz dashboardu přímo na EVO bez externí reverse proxy.
  async rewrites() {
    if (!process.env.EVO_API_URL) return [];

    return [
      {
        source: "/api/:path*",
        destination: `${process.env.EVO_API_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
