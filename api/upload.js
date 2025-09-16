// Vercel Serverless Function for EDF File Upload
const formidable = require('formidable');
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
      console.log(`[DEBUG] Found script at: ${scriptPath}`);
      return scriptPath;
    }
  }
  console.error(`[ERROR] Script '${scriptName}' not found`);
  return possiblePaths[0]; // Return first path as fallback
};

// Configure CORS headers
const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
};

export default async function handler(req, res) {
  setCorsHeaders(res);
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[DEBUG] Processing file upload...');
    
    // Parse form data
    const form = formidable({
      maxFileSize: 500 * 1024 * 1024, // 500MB
      uploadDir: '/tmp',
      keepExtensions: true
    });

    const [fields, files] = await form.parse(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('[DEBUG] File uploaded:', file.originalFilename);
    console.log('[DEBUG] File path:', file.filepath);

    // Find Python script
    const pythonScriptPath = getScriptPath('parseEdf.py');
    
    if (!fs.existsSync(pythonScriptPath)) {
      return res.status(500).json({ 
        error: 'Python script not found',
        details: `Script path: ${pythonScriptPath}`
      });
    }

    // Execute Python script
    const python = spawn('python3', [pythonScriptPath, 'info', file.filepath]);
    
    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
      console.log('[PYTHON STDOUT]', data.toString());
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error('[PYTHON STDERR]', data.toString());
    });

    // Wait for Python process to complete
    await new Promise((resolve, reject) => {
      python.on('close', (code) => {
        console.log('[DEBUG] Python process exited with code:', code);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Python process failed with code ${code}: ${errorOutput}`));
        }
      });

      python.on('error', (error) => {
        console.error('[ERROR] Python process error:', error);
        reject(error);
      });
    });

    // Parse Python output
    try {
      const parsed = JSON.parse(output);
      console.log('[DEBUG] Parsed response:', parsed);

      const response = {
        channels: parsed.signalLabels,
        sampleRates: parsed.frequencies,
        duration: parsed.duration,
        startTime: parsed.startTime,
        previewData: {},
        diagnostics: {},
        patientInfo: parsed.patientInfo || "Unknown patient",
        recordingInfo: parsed.recordingInfo || "Unknown recording",
        tempFilePath: file.filepath,
        originalFileName: file.originalFilename,
      };

      // Clean up uploaded file after processing
      setTimeout(() => {
        try {
          fs.unlinkSync(file.filepath);
          console.log('[DEBUG] Cleaned up uploaded file');
        } catch (err) {
          console.error('[ERROR] Failed to cleanup file:', err);
        }
      }, 30000); // Clean up after 30 seconds

      return res.status(200).json(response);
    } catch (parseError) {
      console.error('[ERROR] Failed to parse Python output:', parseError);
      return res.status(500).json({ 
        error: 'Failed to parse EDF file', 
        details: output 
      });
    }

  } catch (error) {
    console.error('[ERROR] Upload handler error:', error);
    return res.status(500).json({ 
      error: 'Failed to process file upload', 
      details: error.message 
    });
  }
}
