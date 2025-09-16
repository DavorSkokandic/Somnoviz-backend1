// Vercel Health Check Endpoint
export default function handler(req, res) {
  // Configure CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    server: 'Vercel',
    runtime: 'Node.js + Python',
    timeout: '10 seconds',
    platform: 'serverless'
  });
}
