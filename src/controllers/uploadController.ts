// src/controllers/uploadController.ts

import { Request, Response } from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export const handleFileUpload = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded." });

    console.log("[DEBUG] File uploaded:", file.originalname);
    console.log("[DEBUG] File path:", file.path);

    const filePath = path.resolve(file.path);
    const pythonScriptPath = path.resolve(__dirname, "../scripts/parseEdf.py");
    
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
        console.error("Python error:", errorOutput);
        res.status(500).json({ error: "Greška pri obradi fajla.", details: errorOutput });
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

  const pythonScriptPath = path.resolve(__dirname, "../scripts/parseEdf.py");
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
      res.status(500).json({ error: "Greška pri dohvaćanju chunka.", details: errorOutput });
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

    const scriptPath = path.resolve(__dirname, '../scripts/parseEdf.py');
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
        let errorMessage = "Greška pri dohvaćanju chunka.";
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
    
    const pythonProcess = spawn('python', [path.resolve(__dirname, '../scripts/parseEdf.py'), ...args]);

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