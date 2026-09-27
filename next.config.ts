import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ];
    return [
      { source: "/:path*", headers: security },
      ...[
        "/dashboard/:path*",
        "/onboarding",
        "/login",
        "/signup",
        "/auth/:path*",
        "/api/v1/:path*",
      ].map((source) => ({
        source,
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
        ],
      })),
    ];
  },
};

export default nextConfig;
