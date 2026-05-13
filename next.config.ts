import type { NextConfig } from "next";

const config: NextConfig = {
  images: {
    remotePatterns: [],
  },
  // Remap .js imports → .tsx / .ts / .js so ESM-style imports from lib/ work in webpack.
  // This lets the app/ tree import the same lib/ modules that tsx scripts use
  // without changing every import statement.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack(cfg: any) {
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.extensionAlias = {
      ".js": [".tsx", ".ts", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return cfg;
  },
};

export default config;
