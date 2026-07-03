/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // 对图标/图表库做更彻底的按需引入，减小客户端 bundle
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // 基础安全头：防点击劫持、MIME 嗅探；CSP 为兜底第二层防护（当前无内联脚本注入点）
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
