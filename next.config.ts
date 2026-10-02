import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "kokoro-js", "@huggingface/transformers", "onnxruntime-node", "tesseract.js", "@napi-rs/canvas", "unpdf", "mammoth", "word-extractor", "jszip"],
  experimental: { serverActions: { bodySizeLimit: "70mb" } },
  outputFileTracingExcludes: { "*": ["./node_modules/@huggingface/transformers/.cache/**", "./storage/**"] },
};

export default nextConfig;
