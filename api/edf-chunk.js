// Vercel Serverless Function for EDF Chunk Data
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Helper function to find Python script
const getScriptPath = (scriptName) => {
  const possiblePaths = [
    path.resolve(__dirname, `../src/scripts/${scriptName}`),
    path.resolve(process.cwd(), `src/scripts/${scriptName}`),
    path.resolve(process.cwd(), `scripts/${scriptName}`),
    path.resolve(__dirname, `../scripts/${scriptName}`)
  ];

  for (const scriptPath of possiblePaths) {
    if (fs.existsSync(scriptPath)) {
      return scriptPath;
    }
  }
  return possiblePaths[0];
};

// Configure CORS headers
const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
};

export default async function handler(req, res) {
  setCorsHeaders(res);
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { filePath, channel, start_sample, num_samples } = req.query;
    
    if (!filePath || !channel || start_sample === undefined || num_samples === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const pythonScriptPath = getScriptPath('parseEdf.py');
    const args = [
      pythonScriptPath,
      'chunk',
      filePath,
      channel,
      start_sample,
      num_samples
    ];

    const python = spawn('python3', args);
    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    await new Promise((resolve, reject) => {
      python.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Python process failed: ${errorOutput}`));
        }
      });

      python.on('error', (error) => {
        reject(error);
      });
    });

    const parsed = JSON.parse(output);
    return res.status(200).json(parsed);

  } catch (error) {
    console.error('[ERROR] EDF chunk error:', error);
    return res.status(500).json({ 
      error: 'Failed to get EDF chunk', 
      details: error.message 
    });
  }
}
