/** @type {import('next').NextConfig} */
const nextConfig = {
  // Proxy API and WebSocket requests to the backend
  // This means only port 3000 needs to be exposed!
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
      {
        source: "/ws/:path*",
        destination: "http://localhost:8000/ws/:path*",
      },
      {
        source: "/health",
        destination: "http://localhost:8000/health",
      },
    ];
  },
};

export default nextConfig;
