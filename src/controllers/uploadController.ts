// src/controllers/uploadController.ts

import { Request, Response } from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

// Helper function to get correct script paths in both development and production
const getScriptPath = (scriptName: string): string => {
  // List of possible paths to check (in order of preference)
  const possiblePaths = [
    // Development: TypeScript source
    path.resolve(__dirname, `../scripts/${scriptName}`),
    // Development: if running from compiled dist
    path.resolve(__dirname, `../../src/scripts/${scriptName}`),
    // Production: Railway deployment
    path.resolve(process.cwd(), `src/scripts/${scriptName}`),
    // Alternative production path
    path.resolve(process.cwd(), `dist/scripts/${scriptName}`),
    // Fallback: relative to project root
    path.resolve(process.cwd(), `scripts/${scriptName}`)
  ];

  // Try each path and return the first one that exists
  for (const scriptPath of possiblePaths) {
    if (fs.existsSync(scriptPath)) {
      console.log(`[DEBUG] Found script at: ${scriptPath}`);
      return scriptPath;
    }
  }

  // If none found, log all attempted paths and return the first one
  console.error(`[ERROR] Script '${scriptName}' not found in any of these locations:`);
  possiblePaths.forEach((p, i) => {
    console.error(`  ${i + 1}. ${p} (exists: ${fs.existsSync(p)})`);
  });
  
  return possiblePaths[0]; // Return first path as fallback
};

export const handleFileUpload = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded." });

    console.log("[DEBUG] File uploaded:", file.originalname);
    console.log("[DEBUG] File path:", file.path);

    const filePath = path.resolve(file.path);
    const pythonScriptPath = getScriptPath("parseEdf.py");
    
    console.log("[DEBUG] Python script path:", pythonScriptPath);
    console.log("[DEBUG] Python script exists:", fs.existsSync(pythonScriptPath));
    
    const python = spawn("python", [pythonScriptPath, "info", filePath]);

    let output = "";
    let errorOutput = "";

    python.stdout.on("data", (data) => {
      output += data.toString();
      console.log("[PYTHON STDOUT]", data.toString());
    });

    python.stderr.on("data", (data) => {
      const err = data.toString();
      errorOutput += err;
      console.error("[PYTHON STDERR]", err);
    });

    python.on("close", (code) => {
      console.log("[DEBUG] Python process exited with code:", code);
      if (code === 0) {
        try {
          const parsed = JSON.parse(output);
          console.log("[DEBUG] Parsed response:", parsed);

                  // For now, use empty preview data - the frontend will load initial data via useEffect
        const previewData: { [channel: string]: number[] } = {};

        const response = {
          channels: parsed.signalLabels,
          sampleRates: parsed.frequencies,
          duration: parsed.duration,
          startTime: parsed.startTime,
          previewData,
          diagnostics: {},
          patientInfo: parsed.patientInfo || "Nepoznat pacijent",
          recordingInfo: parsed.recordingInfo || "Nepoznata snimka",
          tempFilePath: filePath,
          originalFileName: file.originalname,
        };

          res.json(response);
        } catch (parseError) {
          console.error("[ERROR] Failed to parse Python output:", parseError);
          res.status(500).json({ error: "Failed to parse Python script output", details: output });
        }
      } else {
        console.error("[ERROR] Python process failed with code:", code);
        console.error("[ERROR] Python error output:", errorOutput);
        console.error("[ERROR] Python stdout:", output);
        
        // More detailed error message
        let errorMessage = "Failed to process EDF file";
        if (errorOutput.includes("No such file or directory")) {
          errorMessage = "Python script not found. Please check server configuration.";
        } else if (errorOutput.includes("ModuleNotFoundError") || errorOutput.includes("ImportError")) {
          errorMessage = "Required Python modules are missing. Please check server dependencies.";
        } else if (errorOutput.trim()) {
          errorMessage = `Python processing error: ${errorOutput.trim()}`;
        }
        
        res.status(500).json({ 
          error: errorMessage,
          details: errorOutput,
          code: code,
          pythonScriptPath: pythonScriptPath,
          scriptExists: fs.existsSync(pythonScriptPath)
        });
      }
    });

    python.on("error", (error) => {
      console.error("[ERROR] Python process error:", error);
      res.status(500).json({ error: "Failed to start Python process", details: error.message });
    });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ error: "Internal server error." });
  }
};
export const handleEdfChunk = async (req: Request, res: Response) => {
  const { filePath, channel, start_sample, num_samples } = req.query;

  if (!filePath || !channel || !start_sample || !num_samples) {
    return res.status(400).json({ error: "Nedostaju parametri." });
  }

  const decodedPath = decodeURIComponent(filePath as string);
  if (!fs.existsSync(decodedPath)) {
    return res.status(404).json({ error: "Fajl ne postoji." });
  }

  const pythonScriptPath = getScriptPath("parseEdf.py");
  const args = [pythonScriptPath, "chunk", decodedPath, channel as string, start_sample as string, num_samples as string];

  console.log("Executing Python chunk script with:", args.join(" "));

  const python = spawn("python", args);

  let output = "";
  let errorOutput = "";

  python.stdout.on("data", (data) => {
    output += data.toString();
  });

  python.stderr.on("data", (data) => {
    const err = data.toString();
    errorOutput += err;
    console.error("[PYTHON STDERR]", err);
  });

  python.on("close", (code) => {
    if (code === 0) {
      const parsed = JSON.parse(output);
      res.json(parsed);
    } else {
      console.error("Python error:", errorOutput);
      res.status(500).json({ error: "Error fetching chunk data.", details: errorOutput });
    }
  });
};

export const handleEdfChunkDownsample = async (req: Request, res: Response) => {
  try {
    const { filePath, channel, start_sample, num_samples, target_points } = req.query;

    console.log("[DEBUG] handleEdfChunkDownsample called with:", { filePath, channel, start_sample, num_samples, target_points });

    if (!filePath || !channel || !start_sample || !num_samples || !target_points) {
      console.log("[ERROR] Missing parameters:", { filePath, channel, start_sample, num_samples, target_points });
      return res.status(400).json({ error: "Nedostaju parametri." });
    }

    const decodedPath = decodeURIComponent(filePath as string);
    console.log("[DEBUG] Decoded file path:", decodedPath);
    console.log("[DEBUG] File exists:", fs.existsSync(decodedPath));
    
    if (!fs.existsSync(decodedPath)) {
      console.log("[ERROR] File not found:", decodedPath);
      return res.status(404).json({ error: "Fajl ne postoji." });
    }

    const scriptPath = getScriptPath('parseEdf.py');
    console.log("[DEBUG] Python script path:", scriptPath);
    console.log("[DEBUG] Python script exists:", fs.existsSync(scriptPath));
    
    if (!fs.existsSync(scriptPath)) {
      console.log("[ERROR] Python script not found:", scriptPath);
      return res.status(500).json({ error: "Python script not found. Please check the installation." });
    }
    
    const args = [scriptPath, "chunk-downsample", decodedPath, channel as string, start_sample as string, num_samples as string, target_points as string];

    console.log("[DEBUG] Executing Python downsample script with:", args.join(" "));

    const python = spawn("python", args);

    let output = "";
    let errorOutput = "";

    python.stdout.on("data", (data) => {
      output += data.toString();
      console.log("[PYTHON STDOUT]", data.toString());
    });

    python.stderr.on("data", (data) => {
      const err = data.toString();
      errorOutput += err;
      console.error("[PYTHON STDERR]", err);
    });

    python.on("close", (code) => {
      console.log("[DEBUG] Python process exited with code:", code);
      if (code === 0) {
        try {
          const parsed = JSON.parse(output);
          console.log("[DEBUG] Successfully parsed Python output");
          res.json(parsed);
        } catch (err) {
          console.error("[ERROR] JSON parse failed:", err);
          console.error("[PYTHON STDOUT]", output);
          res.status(500).json({ error: "Failed to parse response from Python script." });
        }
      } else {
        console.error("[ERROR] Python error:", errorOutput);
        
        // Provide more helpful error messages
        let errorMessage = "Error fetching chunk data.";
        if (errorOutput.includes("ModuleNotFoundError") || errorOutput.includes("ImportError")) {
          errorMessage = "Python dependencies are missing. Please install: pip install pyedflib numpy mne";
        } else if (errorOutput.includes("FileNotFoundError")) {
          errorMessage = "EDF file not found or corrupted.";
        } else if (errorOutput.includes("IndexError")) {
          errorMessage = "Invalid channel or sample range.";
        }
        
        res.status(500).json({ 
          error: errorMessage, 
          details: errorOutput,
          suggestion: "Check if Python and required packages (pyedflib, numpy, mne) are installed"
        });
      }
    });

    python.on("error", (error) => {
      console.error("[ERROR] Python process error:", error);
      res.status(500).json({ 
        error: "Failed to start Python process", 
        details: error.message,
        suggestion: "Make sure Python is installed and available in PATH"
      });
    });
  } catch (error) {
    console.error("[ERROR] Unexpected error in handleEdfChunkDownsample:", error);
    res.status(500).json({ error: "Internal server error in handleEdfChunkDownsample." });
  }
};

export const handleEdfMultiChunk = async (req: Request, res: Response) => {
  try {
    console.log('[DEBUG] Multi-chunk request received:', req.query);
    

    // Accept time in seconds for robust, channel-agnostic requests
    const { filePath, channels, start_sec, end_sec, max_points } = req.query;

    if (!filePath || !channels || start_sec === undefined || end_sec === undefined || !max_points) {
      console.log('[ERROR] Missing parameters:', { filePath: !!filePath, channels: !!channels, start_sec: start_sec !== undefined, end_sec: end_sec !== undefined, max_points: !!max_points });
      return res.status(400).json({ error: 'Missing required query parameters.' });
    }

    const decodedFilePath = decodeURIComponent(filePath as string);
    const parsedChannels = JSON.parse(channels as string);
    
    console.log('[DEBUG] Parsed parameters:', {
      filePath: decodedFilePath,
      channels: parsedChannels,
      start_sec,
      end_sec,
      max_points
    });

    const args = [
      'multi-chunk-downsample',
      decodedFilePath,
      JSON.stringify(parsedChannels),
      String(start_sec),
      String(end_sec),
      max_points as string,
    ];

    console.log('[DEBUG] Spawning Python process with args:', args);
    
    const pythonProcess = spawn('python', [getScriptPath('parseEdf.py'), ...args]);

    let result = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[PYTHON STDOUT]', output);
      result += output;
    });

    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString();
      console.log('[PYTHON STDERR]', error);
      errorOutput += error;
    });

    pythonProcess.on('close', (code) => {
      console.log('[DEBUG] Python process closed with code:', code);
      console.log('[DEBUG] Result length:', result.length);
      
      if (code === 0) {
        try {
          const parsed = JSON.parse(result);
          console.log('[DEBUG] Multi-channel response parsed successfully:', {
            hasLabels: !!parsed.labels,
            labelCount: parsed.labels?.length || 0,
            channelCount: Object.keys(parsed.channels || {}).length
          });
          res.json(parsed);
        } catch (err) {
          console.error('[ERROR] JSON parse failed:', err);
          console.error('[PYTHON STDOUT]', result);
          res.status(500).json({ error: 'Failed to parse response from Python script.' });
        }
      } else {
        console.error('[PYTHON STDERR]', errorOutput);
        res.status(500).json({ error: 'Python script failed.', details: errorOutput });
      }
    });
  } catch (err) {
    console.error('[ERROR] Unexpected server error:', err);
    res.status(500).json({ error: 'Unexpected error occurred.' });
  }
};

export const handleAHIAnalysis = async (req: Request, res: Response) => {
  try {
    console.log('[DEBUG] AHI analysis request received:', req.body);
    
    const { filePath, flowChannel, spo2Channel } = req.body;

    // Validate required parameters
    if (!filePath || !flowChannel || !spo2Channel) {
      console.log('[ERROR] Missing required parameters for AHI analysis');
      return res.status(400).json({ 
        error: 'Missing required parameters: filePath, flowChannel, spo2Channel' 
      });
    }

    const decodedFilePath = decodeURIComponent(filePath);
    
    // Check if file exists
    if (!fs.existsSync(decodedFilePath)) {
      console.log('[ERROR] EDF file not found:', decodedFilePath);
      return res.status(404).json({ error: 'EDF file not found' });
    }

    console.log('[DEBUG] Starting AHI analysis for:', {
      filePath: decodedFilePath,
      flowChannel,
      spo2Channel
    });

    // First, get the full data for both channels using existing parseEdf.py
    const parseEdfScript = getScriptPath("parseEdf.py");
    
    // Get flow channel data
    console.log('[DEBUG] Fetching flow channel data...');
    const flowData = await getChannelData(parseEdfScript, decodedFilePath, flowChannel);
    
    // Get SpO2 channel data  
    console.log('[DEBUG] Fetching SpO2 channel data...');
    const spo2Data = await getChannelData(parseEdfScript, decodedFilePath, spo2Channel);

    // Prepare data for AHI analysis
    const analysisInput = {
      flow_data: flowData.data,
      spo2_data: spo2Data.data,
      flow_sample_rate: flowData.sampleRate,
      spo2_sample_rate: spo2Data.sampleRate
    };

    console.log('[DEBUG] Running AHI analysis algorithm...');
    
    // Run AHI analysis
    const ahiScript = getScriptPath("ahi_analysis.py");
    const analysisResults = await runAHIAnalysis(ahiScript, analysisInput);

    console.log('[DEBUG] AHI analysis completed successfully');
    
    // Return results
    res.json({
      success: true,
      ...analysisResults
    });

  } catch (error) {
    console.error("[ERROR] AHI analysis failed:", error);
    res.status(500).json({ 
      error: "AHI analysis failed", 
      details: error instanceof Error ? error.message : String(error)
    });
  }
};

// Helper function to get channel data
async function getChannelData(scriptPath: string, filePath: string, channel: string): Promise<{data: number[], sampleRate: number}> {
  return new Promise((resolve, reject) => {
    // Get channel info first
    const infoProcess = spawn('python', [scriptPath, 'info', filePath]);
    let infoOutput = '';
    let errorOutput = '';

    infoProcess.stdout.on('data', (data) => {
      infoOutput += data.toString();
    });

    infoProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    infoProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to get file info: ${errorOutput}`));
        return;
      }

      try {
        const fileInfo = JSON.parse(infoOutput);
        const channelIndex = fileInfo.signalLabels.indexOf(channel);
        
        if (channelIndex === -1) {
          reject(new Error(`Channel '${channel}' not found in EDF file`));
          return;
        }

        const sampleRate = fileInfo.frequencies[channelIndex];
        const totalSamples = fileInfo.numSamples[channelIndex];

        // Get downsampled channel data for AHI analysis (use reasonable target points)
        // For AHI, we need ~1-2 Hz resolution (events are >10s long), so 10000-20000 points is sufficient
        const targetPoints = Math.min(20000, Math.floor(totalSamples / 10)); // Downsample but keep reasonable resolution
        
        console.log(`[DEBUG] Getting channel data: ${channel}, totalSamples: ${totalSamples}, targetPoints: ${targetPoints}`);
        
        const dataProcess = spawn('python', [scriptPath, 'chunk-downsample', filePath, channel, '0', totalSamples.toString(), targetPoints.toString()]);
        let dataOutput = '';
        let dataError = '';

        dataProcess.stdout.on('data', (data) => {
          dataOutput += data.toString();
        });

        dataProcess.stderr.on('data', (data) => {
          dataError += data.toString();
          console.log('[DEBUG] Python stderr:', data.toString());
        });

        dataProcess.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Failed to get channel data: ${dataError}`));
            return;
          }

          try {
            const channelData = JSON.parse(dataOutput);
            // Calculate effective sample rate after downsampling
            const effectiveSampleRate = channelData.data.length / (totalSamples / sampleRate);
            
            console.log(`[DEBUG] Channel data retrieved: ${channelData.data.length} points, effective rate: ${effectiveSampleRate.toFixed(2)} Hz`);
            
            resolve({
              data: channelData.data,
              sampleRate: effectiveSampleRate // Use effective sample rate for AHI analysis
            });
          } catch (parseError) {
            reject(new Error(`Failed to parse channel data: ${parseError}`));
          }
        });
      } catch (parseError) {
        reject(new Error(`Failed to parse file info: ${parseError}`));
      }
    });
  });
}

// Helper function to run AHI analysis
async function runAHIAnalysis(scriptPath: string, inputData: any): Promise<any> {
  return new Promise((resolve, reject) => {
    // Create a temporary file to pass JSON data (avoids PowerShell JSON escaping issues)
    const tempFile = path.join(__dirname, `temp_ahi_input_${Date.now()}.json`);
    
    try {
      // Write input data to temporary file
      fs.writeFileSync(tempFile, JSON.stringify(inputData));
      console.log('[DEBUG] Created temp file:', tempFile);
      
      // Modified AHI script to read from file instead of command line
      const analysisProcess = spawn('python', [scriptPath, tempFile]);
      let output = '';
      let errorOutput = '';

      analysisProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      analysisProcess.stderr.on('data', (data) => {
        const err = data.toString();
        errorOutput += err;
        console.log('[AHI STDERR]', err); // Log for debugging
      });

      analysisProcess.on('close', (code) => {
        // Clean up temp file
        try {
          fs.unlinkSync(tempFile);
          console.log('[DEBUG] Cleaned up temp file:', tempFile);
        } catch (cleanupError) {
          console.warn('[WARN] Failed to clean up temp file:', cleanupError);
        }

        if (code !== 0) {
          reject(new Error(`AHI analysis failed: ${errorOutput}`));
          return;
        }

        try {
          const results = JSON.parse(output);
          resolve(results);
        } catch (parseError) {
          reject(new Error(`Failed to parse AHI results: ${parseError}`));
        }
      });
    } catch (fileError) {
      reject(new Error(`Failed to create temp file: ${fileError}`));
    }
  });
};

// Handler for finding max/min values from raw data
export const handleMaxMinValues = async (req: Request, res: Response) => {
  try {
    const { filePath, channels, startSec = 0, endSec } = req.body;
    
    if (!filePath || !channels || !Array.isArray(channels)) {
      return res.status(400).json({ error: "Missing required parameters: filePath and channels array" });
    }

    console.log('[DEBUG] Max-min request:', { filePath, channels, startSec, endSec });

    const scriptPath = getScriptPath("parseEdf.py");
    
    // Prepare command arguments
    const args = [
      scriptPath,
      'max-min',
      filePath,
      JSON.stringify(channels),
      startSec.toString()
    ];
    
    if (endSec !== undefined) {
      args.push(endSec.toString());
    }

    console.log('[DEBUG] Running max-min command:', args);

    const python = spawn('python', args);
    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.log('[DEBUG] Python stderr:', data.toString());
    });

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('[ERROR] Max-min analysis failed:', errorOutput);
        return res.status(500).json({ error: `Max-min analysis failed: ${errorOutput}` });
      }

      try {
        const results = JSON.parse(output);
        console.log('[DEBUG] Max-min results:', results);
        res.json({ success: true, data: results });
      } catch (parseError) {
        console.error('[ERROR] Failed to parse max-min results:', parseError);
        res.status(500).json({ error: 'Failed to parse max-min results' });
      }
    });

  } catch (error) {
    console.error('[ERROR] Max-min analysis error:', error);
    res.status(500).json({ error: 'Max-min analysis failed' });
  }
};