// server.ts
import express from 'express';
import cors from 'cors'; // Ispravan import
import dotenv from 'dotenv'; // Ispravan import
import uploadRoutes from './routes/upload';
import { fileCleanupService } from './services/fileCleanupService';
import cleanupConfig from './config/cleanup.config';

dotenv.config();
const app = express();

const PORT = process.env.PORT || 5000;

// Configure CORS for development and production
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? true // Allow all origins in production (or specify your domain)
    : ["http://localhost:5173", "http://localhost:3000"], // Development origins
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
  optionsSuccessStatus: 200 // For legacy browser support
};

app.use(cors(corsOptions));

app.use(express.json()); // Za parsiranje JSON tijela zahtjeva

app.get('/', (_req, res) => {
  res.send('Somnoviz Backend Running!');
});

// Add test endpoint
app.get('/test', (_req, res) => {
  res.json({ 
    message: 'Backend is working!',
    timestamp: new Date().toISOString(),
    pythonAvailable: true // We'll test this
  });
});

// Add Python test endpoint
app.get('/test-python', async (_req, res) => {
  try {
    const { spawn } = require('child_process');
    const path = require('path');
    
    const scriptPath = path.resolve(__dirname, 'scripts/test_python.py');
    const python = spawn('python', [scriptPath]);
    
    let output = '';
    let errorOutput = '';
    
    python.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    
    python.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });
    
    python.on('close', (code: number) => {
      if (code === 0) {
        try {
          const result = JSON.parse(output);
          res.json(result);
        } catch (err) {
          res.json({ 
            success: false, 
            error: 'Failed to parse Python test output',
            output,
            errorOutput
          });
        }
      } else {
        res.json({ 
          success: false, 
          error: 'Python test failed',
          code,
          errorOutput
        });
      }
    });
    
    python.on('error', (error: Error) => {
      res.json({ 
        success: false, 
        error: 'Failed to start Python process',
        details: error.message
      });
    });
  } catch (error) {
    res.json({ 
      success: false, 
      error: 'Server error during Python test',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.use("/api/upload", uploadRoutes); // Montira vašu rutu

// Add cleanup status endpoint
app.get('/api/cleanup/stats', async (_req, res) => {
  try {
    const stats = await fileCleanupService.getStats();
    res.json({
      success: true,
      stats,
      config: {
        maxAgeHours: cleanupConfig.maxAgeHours,
        uploadDir: cleanupConfig.uploadDir,
        intervalMinutes: cleanupConfig.intervalMinutes,
        enabled: cleanupConfig.enabled
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cleanup stats',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Add manual cleanup endpoint (for testing/admin)
app.post('/api/cleanup/manual', async (_req, res) => {
  try {
    const result = await fileCleanupService.manualCleanup();
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Manual cleanup failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  
  // Start the automatic file cleanup service if enabled
  if (cleanupConfig.enabled) {
    console.log(`[FileCleanup] Configuration:`);
    console.log(`  - Max file age: ${cleanupConfig.maxAgeHours} hours`);
    console.log(`  - Cleanup interval: ${cleanupConfig.intervalMinutes} minutes`);
    console.log(`  - Upload directory: ${cleanupConfig.uploadDir}`);
    
    // Initialize service with config
    fileCleanupService.updateConfig(cleanupConfig.maxAgeHours);
    fileCleanupService.start(cleanupConfig.intervalMinutes);
  } else {
    console.log(`[FileCleanup] Automatic cleanup is disabled`);
  }
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Graceful shutdown...');
    fileCleanupService.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM. Graceful shutdown...');
    fileCleanupService.stop();
    process.exit(0);
  });
});