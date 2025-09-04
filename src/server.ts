// server.ts
import express from 'express';
import cors from 'cors'; // Ispravan import
import dotenv from 'dotenv'; // Ispravan import
import uploadRoutes from './routes/upload';

dotenv.config();
const app = express();

const PORT = process.env.PORT || 5000;

// Postavite CORS middleware na početku i samo jednom
app.use(cors({
  origin: "http://localhost:5173", // Dopušten samo vaš frontend origin
  methods: ["GET", "POST", "PUT", "DELETE"], // Dopuštene metode
  credentials: true, // Omogućava slanje kolačića i HTTP autentifikacijskih headera
}));

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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});