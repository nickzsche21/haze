import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      // The camera stream is read, drawn, and thrown away in the page; nothing
      // is uploaded. MediaPipe's GPU delegate is happier with these set.
      source: "/(.*)",
      headers: [
        { key: "Permissions-Policy", value: "camera=(self), microphone=()" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    },
  ],
};

export default nextConfig;
