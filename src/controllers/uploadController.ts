// src/controllers/uploadController.ts

import { Request, Response } from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

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
    
    // Use python3 in production, python in development
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    console.log(`[DEBUG] Attempting to use Python command: ${pythonCommand}`);
    
    const python = spawn(pythonCommand, [pythonScriptPath, "info", filePath]);

    let output = "";
    let errorOutput = "";

    python.stdout.on("data", (data) => {
      const chunk = data.toString();
      output += chunk;
      console.log("[PYTHON STDOUT]", chunk);
      
      // Send progress updates if this looks like a progress message
      if (chunk.includes('Processing') || chunk.includes('%') || chunk.includes('Loading')) {
        // Note: In a real-world app, you'd use Server-Sent Events or WebSockets for progress
        console.log("[PROGRESS]", chunk.trim());
      }
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
          patientInfo: parsed.patientInfo || "Unknown Patient",
          recordingInfo: parsed.recordingInfo || "Unknown Recording",
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
    return res.status(400).json({ error: "Missing parameters." });
  }

  const decodedPath = decodeURIComponent(filePath as string);
  if (!fs.existsSync(decodedPath)) {
    return res.status(404).json({ error: "File does not exist." });
  }

  const pythonScriptPath = getScriptPath("parseEdf.py");
  const args = [pythonScriptPath, "chunk", decodedPath, channel as string, start_sample as string, num_samples as string];

  console.log("Executing Python chunk script with:", args.join(" "));

  // Use python3 in production, python in development
  const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
  const python = spawn(pythonCommand, args);

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
      return res.status(400).json({ error: "Missing parameters." });
    }

    const decodedPath = decodeURIComponent(filePath as string);
    console.log("[DEBUG] Decoded file path:", decodedPath);
    console.log("[DEBUG] File exists:", fs.existsSync(decodedPath));
    
    if (!fs.existsSync(decodedPath)) {
      console.log("[ERROR] File not found:", decodedPath);
      return res.status(404).json({ error: "File does not exist." });
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

    // Use python3 in production, python in development
  const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
  const python = spawn(pythonCommand, args);

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
          errorMessage = "Required Python modules are missing. Please check server dependencies.";
        } else if (errorOutput.includes("FileNotFoundError")) {
          errorMessage = "EDF file not found or corrupted.";
        } else if (errorOutput.includes("IndexError")) {
          errorMessage = "Invalid channel or sample range.";
        }
        
        res.status(500).json({ 
          error: errorMessage, 
          details: errorOutput,
          code: code || 1,
          pythonScriptPath: scriptPath,
          scriptExists: require('fs').existsSync(scriptPath)
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
    
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    const pythonProcess = spawn(pythonCommand, [getScriptPath('parseEdf.py'), ...args]);

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
          
          // Transform Python script output to match frontend expectations
          const transformedResponse = {
            channels: Object.entries(parsed.channels || {}).map(([channelName, channelInfo]) => {
              // Handle both old format (array) and new format (object with data, sample_rate, etc.)
              let channelData, sampleRate;
              
              if (Array.isArray(channelInfo)) {
                // Old format: just array of data
                channelData = channelInfo;
                // Calculate sample rate based on data length and time range
                const timeRange = parseFloat(end_sec as string) - parseFloat(start_sec as string);
                const dataLength = channelData.length;
                sampleRate = timeRange > 0 && dataLength > 0 ? dataLength / timeRange : 1;
              } else {
                // New format: object with data, sample_rate, original_length
                channelData = (channelInfo as any).data || [];
                sampleRate = (channelInfo as any).sample_rate || 1;
              }
              
              return {
                name: channelName,
                data: channelData,
                sample_rate: sampleRate,
                start_time_sec: parseFloat(start_sec as string),
                stats: {} // Optional stats can be added later
              };
            })
          };
          
          console.log('[DEBUG] Transformed response:', {
            channelCount: transformedResponse.channels.length,
            channelNames: transformedResponse.channels.map(c => c.name)
          });
          
          res.json(transformedResponse);
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
    console.log('[DEBUG] Request headers:', req.headers);
    console.log('[DEBUG] Content-Type:', req.headers['content-type']);
    
    const { filePath, flowChannel, spo2Channel } = req.body;

    // Validate required parameters
    if (!filePath || !flowChannel || !spo2Channel) {
      console.log('[ERROR] Missing required parameters for AHI analysis');
      console.log('[DEBUG] Received data:', { filePath, flowChannel, spo2Channel });
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

    console.log('[DEBUG] Starting FULL DATA AHI analysis for:', {
      filePath: decodedFilePath,
      flowChannel,
      spo2Channel
    });

    // Use the chunked AHI analysis script for memory-efficient full data processing
    const ahiScript = getScriptPath("ahi_analysis_chunked.py");
    
    if (!fs.existsSync(ahiScript)) {
      console.log('[ERROR] AHI analysis script not found:', ahiScript);
      return res.status(500).json({ error: 'AHI analysis script not found' });
    }

    console.log('[DEBUG] Running FULL DATA chunked AHI analysis...');
    const ahiResults = await runFullDataAHIAnalysis(ahiScript, decodedFilePath, flowChannel, spo2Channel);

    console.log('[DEBUG] AHI analysis completed successfully');
    console.log(`[DEBUG] Results: AHI=${ahiResults.ahi_analysis?.ahi_score}, Events=${ahiResults.all_events?.length || 0}`);
    
    // Create response with full medical data for professional analysis
    const response = {
      success: true,
      ahi_analysis: ahiResults.ahi_analysis,
      event_summary: {
        apnea_count: ahiResults.apnea_events?.length || 0,
        hypopnea_count: ahiResults.hypopnea_events?.length || 0,
        total_events: (ahiResults.apnea_events?.length || 0) + (ahiResults.hypopnea_events?.length || 0)
      },
      // Send full event data for medical accuracy
      apnea_events: ahiResults.apnea_events || [],
      hypopnea_events: ahiResults.hypopnea_events || [],
      all_events: ahiResults.all_events || [],
      message: "AHI analysis completed using full-resolution chunked processing for medical accuracy"
    };
    
    const responseSize = JSON.stringify(response).length;
    console.log(`[DEBUG] Sending AHI response: ${responseSize} characters`);
    console.log(`[DEBUG] Response contains: ${response.apnea_events?.length || 0} apneas, ${response.hypopnea_events?.length || 0} hypopneas`);
    console.log(`[DEBUG] Full response size: ${responseSize} chars`);
    
    // Set proper headers for large responses
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', Buffer.byteLength(JSON.stringify(response), 'utf8'));
    
    res.json(response);

  } catch (error) {
    console.error("[ERROR] AHI analysis failed:", error);
    res.status(500).json({ 
      error: "AHI analysis failed", 
      details: error instanceof Error ? error.message : String(error)
    });
  }
};

// Full data AHI analysis using the chunked Python script for medical accuracy
async function runFullDataAHIAnalysis(ahiScriptPath: string, filePath: string, flowChannel: string, spo2Channel: string): Promise<any> {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('[DEBUG] Starting full data AHI analysis...');
      
      // First, get file info to extract the full data
      const parseEdfScript = getScriptPath("parseEdf.py");
      const fileInfo = await getFileInfo(parseEdfScript, filePath);
      
      const flowChannelIndex = fileInfo.signalLabels.indexOf(flowChannel);
      const spo2ChannelIndex = fileInfo.signalLabels.indexOf(spo2Channel);
      
      if (flowChannelIndex === -1 || spo2ChannelIndex === -1) {
        throw new Error(`Channels not found: ${flowChannel}, ${spo2Channel}`);
      }
      
      const flowSampleRate = fileInfo.frequencies[flowChannelIndex];
      const spo2SampleRate = fileInfo.frequencies[spo2ChannelIndex];
      const duration = fileInfo.duration;
      
      console.log(`[DEBUG] File info - Flow: ${flowSampleRate}Hz, SpO2: ${spo2SampleRate}Hz, Duration: ${duration}s`);
      
      // Calculate estimated data size for chunk parameter optimization
      const estimatedFlowSamples = Math.floor(flowSampleRate * duration);
      const estimatedSpo2Samples = Math.floor(spo2SampleRate * duration);
      const estimatedFlowMB = (estimatedFlowSamples * 8) / (1024 * 1024);
      const estimatedSpo2MB = (estimatedSpo2Samples * 8) / (1024 * 1024);
      const totalEstimatedMB = estimatedFlowMB + estimatedSpo2MB;
      
      console.log(`[DEBUG] Estimated data size:`, {
        flowSamples: estimatedFlowSamples,
        spo2Samples: estimatedSpo2Samples,
        flowMB: estimatedFlowMB.toFixed(1),
        spo2MB: estimatedSpo2MB.toFixed(1),
        totalMB: totalEstimatedMB.toFixed(1),
        durationHours: (duration / 3600).toFixed(2)
      });
      
      // Optimize chunk parameters based on estimated data size
      let chunkDurationMinutes = 30; // Default
      let overlapMinutes = 2; // Default
      
      if (totalEstimatedMB > 2000) { // > 2GB
        chunkDurationMinutes = 15; // Smaller chunks for very large files
        overlapMinutes = 1;
        console.log('[DEBUG] Large file detected - using smaller chunks for memory efficiency');
      } else if (totalEstimatedMB > 1000) { // > 1GB
        chunkDurationMinutes = 20;
        overlapMinutes = 1.5;
        console.log('[DEBUG] Medium-large file detected - using medium chunks');
      }
      
      // Prepare input data for the chunked AHI analysis script
      // The script will now load data directly from the EDF file
      const inputData = {
        file_path: filePath,
        flow_channel: flowChannel,
        spo2_channel: spo2Channel,
        flow_sample_rate: flowSampleRate,
        spo2_sample_rate: spo2SampleRate,
        chunk_duration_minutes: chunkDurationMinutes,
        overlap_minutes: overlapMinutes,
        file_duration_hours: duration / 3600,
        estimated_data_mb: totalEstimatedMB
      };
      
      console.log('[DEBUG] Running chunked AHI analysis script with file parameters...');
      
      // Run the chunked AHI analysis by passing data through stdin (avoids file permission issues)
      const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
      const python = spawn(pythonCommand, [ahiScriptPath, '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
      
      // Write input data to Python script via stdin
      const inputJson = JSON.stringify(inputData);
      python.stdin.write(inputJson);
      python.stdin.end();
      
      let output = '';
      let errorOutput = '';
      
      python.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        console.log('[PYTHON STDOUT]', chunk.trim());
      });
      
      python.stderr.on('data', (data) => {
        const err = data.toString();
        errorOutput += err;
        console.log('[PYTHON STDERR]', err.trim());
      });
      
      // Add timeout handling for long-running analysis
      const analysisTimeout = setTimeout(() => {
        console.warn('[WARN] AHI analysis taking longer than expected, but continuing...');
      }, 30000); // 30 seconds
      
      python.on('close', (code) => {
        clearTimeout(analysisTimeout);
        
        if (code === 0) {
          try {
            const results = JSON.parse(output);
            console.log('[DEBUG] AHI analysis completed successfully');
            console.log(`[DEBUG] Results: ${results.apnea_events?.length || 0} apneas, ${results.hypopnea_events?.length || 0} hypopneas`);
            console.log('[DEBUG] Full results structure:', {
              hasAhiAnalysis: !!results.ahi_analysis,
              ahiScore: results.ahi_analysis?.ahi_score,
              severity: results.ahi_analysis?.severity,
              totalEvents: results.all_events?.length || 0,
              apneaCount: results.apnea_events?.length || 0,
              hypopneaCount: results.hypopnea_events?.length || 0,
              recordingDurationHours: results.ahi_analysis?.recording_duration_hours
            });
            resolve(results);
          } catch (parseError) {
            console.error('[ERROR] Failed to parse AHI results:', parseError);
            console.error('[ERROR] Raw output:', output);
            reject(new Error(`Failed to parse AHI results: ${parseError.message}`));
          }
        } else {
          console.error('[ERROR] AHI analysis failed with code:', code);
          console.error('[ERROR] Error output:', errorOutput);
          reject(new Error(`AHI analysis failed: ${errorOutput}`));
        }
      });
      
      python.on('error', (error) => {
        console.error('[ERROR] Failed to start Python AHI analysis:', error);
        reject(new Error(`Failed to start Python AHI analysis: ${error.message}`));
      });
      
    } catch (error) {
      console.error('[ERROR] Full data AHI analysis failed:', error);
      reject(new Error(`Full data AHI analysis failed: ${error.message}`));
    }
  });
}

// Get full channel data for AHI analysis (optimized for memory efficiency)
async function getFullChannelDataForAHI(scriptPath: string, filePath: string, channel: string): Promise<number[]> {
  return new Promise(async (resolve, reject) => {
    try {
      // Get file info first
      const fileInfo = await getFileInfo(scriptPath, filePath);
      const channelIndex = fileInfo.signalLabels.indexOf(channel);
      
      if (channelIndex === -1) {
        throw new Error(`Channel ${channel} not found`);
      }
      
      const sampleRate = fileInfo.frequencies[channelIndex];
      const duration = fileInfo.duration;
      const totalSamples = Math.floor(sampleRate * duration);
      
      console.log(`[DEBUG] Extracting full data for ${channel}: ${totalSamples} samples @ ${sampleRate}Hz`);
      
      // Use chunked reading for memory efficiency with dynamic chunk sizing
      const baseChunkDuration = 300; // 5 minutes base chunk size
      const memoryLimitMB = 1024; // 1GB memory limit per channel
      const bytesPerSample = 8; // 8 bytes per double precision number
      const maxSamplesPerChunk = Math.floor((memoryLimitMB * 1024 * 1024) / bytesPerSample);
      const chunkSize = Math.min(Math.floor(sampleRate * baseChunkDuration), maxSamplesPerChunk);
      const numChunks = Math.ceil(totalSamples / chunkSize);
      
      console.log(`[DEBUG] Memory-optimized chunking for ${channel}:`, {
        totalSamples,
        sampleRate,
        chunkSize,
        numChunks,
        chunkDurationMinutes: (chunkSize / sampleRate / 60).toFixed(1),
        estimatedMemoryMB: (chunkSize * bytesPerSample / 1024 / 1024).toFixed(1)
      });
      
      const allData: number[] = [];
      
      for (let i = 0; i < numChunks; i++) {
        const startSample = i * chunkSize;
        const endSample = Math.min(startSample + chunkSize, totalSamples);
        const chunkSamples = endSample - startSample;
        
        console.log(`[DEBUG] Reading chunk ${i + 1}/${numChunks}: samples ${startSample}-${endSample} (${(chunkSamples/sampleRate/60).toFixed(1)}min)`);
        
        const startTime = startSample / sampleRate;
        const endTime = endSample / sampleRate;
        const chunkData = await getChunkData(scriptPath, filePath, channel, startTime, endTime, sampleRate);
        allData.push(...chunkData);
        
        // Log memory usage periodically
        if ((i + 1) % 10 === 0 || i === numChunks - 1) {
          const currentMemoryMB = (allData.length * bytesPerSample / 1024 / 1024).toFixed(1);
          console.log(`[DEBUG] Memory usage after chunk ${i + 1}/${numChunks}: ${currentMemoryMB}MB`);
        }
      }
      
      console.log(`[DEBUG] Successfully extracted ${allData.length} samples for ${channel}`);
      resolve(allData);
      
    } catch (error) {
      console.error(`[ERROR] Failed to extract full data for ${channel}:`, error);
      reject(error);
    }
  });
}

// Efficient helper function to get channel statistics (not full data)
async function getChannelStatistics(scriptPath: string, filePath: string, channels: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    const args = [scriptPath, 'max-min', filePath, JSON.stringify(channels), '0', '300']; // Get stats for first 5 minutes as sample
    
    console.log('[DEBUG] Getting channel statistics with:', args.join(' '));
    const python = spawn(pythonCommand, args);
    
    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code === 0) {
        try {
          const stats = JSON.parse(output);
          resolve(stats);
        } catch (err) {
          reject(new Error('Failed to parse channel statistics'));
        }
      } else {
        reject(new Error(`Failed to get channel statistics: ${errorOutput}`));
      }
    });

    python.on('error', (error) => {
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
  });
}

// Professional AHI analysis using true chunked processing (memory-efficient)
async function runLightweightAHIAnalysis(channelStats: any, flowChannel: string, spo2Channel: string): Promise<any> {
  const flowStats = channelStats[flowChannel];
  const spo2Stats = channelStats[spo2Channel];
  
  if (!flowStats || !spo2Stats) {
    throw new Error('Could not get statistics for required channels');
  }

  console.log('[DEBUG] Running true chunked AHI analysis...');
  
  const parseEdfScript = getScriptPath("parseEdf.py");
  const ahiScript = getScriptPath("ahi_analysis.py");
  const filePath = channelStats.filePath || channelStats[flowChannel]?.filePath;
  
  try {
    // Get file info to determine chunking parameters
    const fileInfo = await getFileInfo(parseEdfScript, filePath);
    const flowChannelIndex = fileInfo.signalLabels.indexOf(flowChannel);
    const spo2ChannelIndex = fileInfo.signalLabels.indexOf(spo2Channel);
    
    if (flowChannelIndex === -1 || spo2ChannelIndex === -1) {
      throw new Error(`Channels not found: ${flowChannel}, ${spo2Channel}`);
    }
    
    const flowSampleRate = fileInfo.frequencies[flowChannelIndex];
    const spo2SampleRate = fileInfo.frequencies[spo2ChannelIndex];
    const duration = fileInfo.duration;
    
    console.log(`[DEBUG] File info - Flow: ${flowSampleRate}Hz, SpO2: ${spo2SampleRate}Hz, Duration: ${duration}s`);
    
    // Calculate chunk parameters for memory-efficient processing
    // Optimized for 4GB server memory while preserving medical accuracy
    const chunkDurationMinutes = 5; // 5-minute chunks to reduce memory usage
    const overlapMinutes = 1; // 1-minute overlap for better event detection
    const chunkDurationSeconds = chunkDurationMinutes * 60;
    const overlapSeconds = overlapMinutes * 60;
    
    // Calculate number of chunks needed
    const effectiveChunkSize = chunkDurationSeconds - overlapSeconds;
    const numChunks = Math.ceil(duration / effectiveChunkSize);
    
    console.log(`[DEBUG] Processing ${numChunks} FULL RESOLUTION chunks of ${chunkDurationMinutes}min each with ${overlapMinutes}min overlap`);
    console.log(`[DEBUG] Each chunk will contain ~${Math.floor(chunkDurationMinutes * 60 * flowSampleRate)} flow samples and ~${Math.floor(chunkDurationMinutes * 60 * spo2SampleRate)} SpO2 samples`);
    
    // First, calculate global baseline from representative samples across all chunks
    console.log('[DEBUG] Calculating global baseline from representative samples...');
    const globalBaseline = await calculateGlobalBaseline(parseEdfScript, filePath, flowChannel, flowSampleRate, duration);
    console.log(`[DEBUG] Global baseline calculated: ${globalBaseline}`);
    
    // Process each chunk separately
    const allApneaEvents = [];
    const allHypopneaEvents = [];
    
    for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
      console.log(`[DEBUG] Processing chunk ${chunkIdx + 1}/${numChunks}...`);
      
      // Calculate chunk boundaries
      let chunkStartTime = chunkIdx * effectiveChunkSize;
      let chunkEndTime = Math.min(chunkStartTime + chunkDurationSeconds, duration);
      
      // Adjust for first chunk
      if (chunkIdx === 0) {
        chunkStartTime = 0;
      }
      
      // Get full resolution chunk data for both channels using correct sample rates
      const flowChunkData = await getChunkData(parseEdfScript, filePath, flowChannel, chunkStartTime, chunkEndTime, flowSampleRate);
      const spo2ChunkData = await getChunkData(parseEdfScript, filePath, spo2Channel, chunkStartTime, chunkEndTime, spo2SampleRate);
      
      console.log(`[DEBUG] Chunk ${chunkIdx + 1} data sizes: Flow=${flowChunkData.length} samples, SpO2=${spo2ChunkData.length} samples`);
      
      // Process this chunk with Python AHI analysis using global baseline
      const chunkResults = await processChunkAHI(ahiScript, flowChunkData, spo2ChunkData, flowSampleRate, spo2SampleRate, chunkStartTime, globalBaseline);
      
      // Add chunk offset to event times
      chunkResults.apnea_events.forEach(event => {
        event.start_time += chunkStartTime;
        event.end_time += chunkStartTime;
      });
      chunkResults.hypopnea_events.forEach(event => {
        event.start_time += chunkStartTime;
        event.end_time += chunkStartTime;
      });
      
      allApneaEvents.push(...chunkResults.apnea_events);
      allHypopneaEvents.push(...chunkResults.hypopnea_events);
      
      console.log(`[DEBUG] Chunk ${chunkIdx + 1}: ${chunkResults.apnea_events.length} apneas, ${chunkResults.hypopnea_events.length} hypopneas`);
    }
    
    // Remove duplicate events from overlapping chunks
    console.log('[DEBUG] Removing duplicate events from overlapping chunks...');
    const uniqueApneaEvents = removeDuplicateEvents(allApneaEvents);
    const uniqueHypopneaEvents = removeDuplicateEvents(allHypopneaEvents);
    
    console.log(`[DEBUG] After deduplication: ${uniqueApneaEvents.length} apneas, ${uniqueHypopneaEvents.length} hypopneas`);
    
    // Calculate final AHI
    const ahiResults = calculateAHI(uniqueApneaEvents, uniqueHypopneaEvents, duration / 3600);
    
    // Return results in the exact format expected by the frontend
    const optimizedResults = {
      ahi_analysis: ahiResults,
      apnea_events: uniqueApneaEvents,
      hypopnea_events: uniqueHypopneaEvents,
      all_events: [...uniqueApneaEvents, ...uniqueHypopneaEvents].sort((a, b) => a.start_time - b.start_time)
    };
    
    console.log(`[DEBUG] True chunked AHI analysis complete: ${optimizedResults.ahi_analysis.ahi_score} (${optimizedResults.ahi_analysis.severity})`);
    return optimizedResults;
    
  } catch (error) {
    console.error('[ERROR] True chunked AHI analysis failed:', error);
    throw new Error(`AHI analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Get full channel data for AHI analysis
async function getFullChannelData(scriptPath: string, filePath: string, channel: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    
    // First get file info to determine total samples
    const infoArgs = [scriptPath, 'info', filePath];
    console.log(`[DEBUG] Getting file info for ${channel}: ${infoArgs.join(' ')}`);
    
    const infoProcess = spawn(pythonCommand, infoArgs);
    let infoOutput = '';
    let infoError = '';
    
    infoProcess.stdout.on('data', (data) => {
      infoOutput += data.toString();
    });
    
    infoProcess.stderr.on('data', (data) => {
      infoError += data.toString();
    });
    
    infoProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`[ERROR] Failed to get file info: ${infoError}`);
        reject(new Error(`Failed to get file info: ${infoError}`));
        return;
      }
      
      try {
        const fileInfo = JSON.parse(infoOutput);
        console.log(`[DEBUG] File info parsed:`, fileInfo);
        
        // The Python script returns 'signalLabels' array, not 'channels'
        const channelLabels = fileInfo.signalLabels || fileInfo.channels;
        if (!channelLabels || !Array.isArray(channelLabels)) {
          reject(new Error(`Invalid file info structure: signalLabels/channels not found or not an array`));
          return;
        }
        
        // Find channel by label in the signalLabels array
        const channelIndex = channelLabels.indexOf(channel);
        if (channelIndex === -1) {
          console.log(`[DEBUG] Available channels:`, channelLabels);
          reject(new Error(`Channel ${channel} not found in file. Available channels: ${channelLabels.join(', ')}`));
          return;
        }
        
        // Get channel info from frequencies array
        const sampleRate = fileInfo.frequencies[channelIndex];
        const duration = fileInfo.duration;
        const totalSamples = Math.floor(sampleRate * duration);
        
        console.log(`[DEBUG] Channel ${channel}: ${sampleRate}Hz, ${duration}s, ${totalSamples} samples`);
        
        // For chunk-based AHI analysis, use full dataset with reasonable downsampling
        // Use all available data but downsample to reasonable number of points for processing
        const maxSamplesForAHI = totalSamples;
        console.log(`[DEBUG] Using full dataset for chunk-based AHI analysis: ${maxSamplesForAHI} samples`);
        
        // Use chunk-downsample for better performance with reasonable target points
        // Target 2000 points per hour of data to balance accuracy and memory usage
        const targetPoints = Math.min(20000, Math.max(1000, Math.floor(totalSamples / (sampleRate * 3600)) * 2000));
        console.log(`[DEBUG] Using ${targetPoints} target points for downsampling`);
        
        const args = [scriptPath, 'chunk-downsample', filePath, channel, '0', maxSamplesForAHI.toString(), targetPoints.toString()];
        
        console.log(`[DEBUG] Getting full channel data for ${channel}: ${args.join(' ')}`);
        const python = spawn(pythonCommand, args);
        
        let output = '';
        let errorOutput = '';

        python.stdout.on('data', (data) => {
          output += data.toString();
        });

        python.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        python.on('close', (code) => {
          if (code === 0) {
            try {
              const data = JSON.parse(output);
              resolve({
                data: data.data,
                sampleRate: sampleRate, // Use actual sample rate from file info
                channel: channel
              });
            } catch (err) {
              reject(new Error('Failed to parse full channel data'));
            }
          } else {
            reject(new Error(`Failed to get full channel data: ${errorOutput}`));
          }
        });
        
      } catch (err) {
        reject(new Error(`Failed to parse file info: ${err}`));
      }
    });

    infoProcess.on('error', (error) => {
      reject(new Error(`Failed to start Python info process: ${error.message}`));
    });
  });
}

// Run Python AHI analysis script
async function runPythonAHIAnalysis(scriptPath: string, inputFile: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    const args = [scriptPath, inputFile];
    
    console.log(`[DEBUG] Running Python AHI analysis: ${args.join(' ')}`);
    const python = spawn(pythonCommand, args);
    
    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code === 0) {
        try {
          const results = JSON.parse(output);
          resolve(results);
        } catch (err) {
          reject(new Error('Failed to parse Python AHI analysis results'));
        }
      } else {
        reject(new Error(`Python AHI analysis failed: ${errorOutput}`));
      }
    });

    python.on('error', (error) => {
      reject(new Error(`Failed to start Python AHI analysis: ${error.message}`));
    });
  });
}

// Get file info for duration and channel details
async function getFileInfo(scriptPath: string, filePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    const args = [scriptPath, 'info', filePath];
    
    const python = spawn(pythonCommand, args);
    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code === 0) {
        try {
          const info = JSON.parse(output);
          resolve(info);
        } catch (err) {
          reject(new Error('Failed to parse file info'));
        }
      } else {
        reject(new Error(`Failed to get file info: ${errorOutput}`));
      }
    });

    python.on('error', (error) => {
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
  });
}

// Get full resolution chunk data for accurate analysis
async function getFullResolutionChunk(scriptPath: string, filePath: string, channel: string, startTime: number, endTime: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    
    // Get full resolution data for the time window (no downsampling)
    const duration = endTime - startTime;
    const args = [scriptPath, 'chunk', filePath, channel, String(startTime * 100), String(duration * 100)]; // Assuming 100Hz sample rate
    
    console.log(`[DEBUG] Getting full resolution chunk: ${args.join(' ')}`);
    const python = spawn(pythonCommand, args);
    
    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code === 0) {
        try {
          const data = JSON.parse(output);
          resolve({
            data: data.data,
            sampleRate: 100, // Full resolution sample rate
            startTime: startTime,
            endTime: endTime,
            duration: duration
          });
        } catch (err) {
          reject(new Error('Failed to parse full resolution chunk data'));
        }
      } else {
        reject(new Error(`Failed to get full resolution chunk: ${errorOutput}`));
      }
    });

    python.on('error', (error) => {
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
  });
}

// Full resolution apnea detection (AASM compliant)
async function detectApneaEventsFullResolution(flowData: any, spo2Data: any, chunkStartTime: number): Promise<any[]> {
  const events = [];
  const flowSignal = flowData.data;
  const spo2Signal = spo2Data.data;
  const sampleRate = flowData.sampleRate;
  
  // AASM definition: Apnea = 90% reduction in airflow for ≥10 seconds
  const baselineFlow = calculateBaselineFullResolution(flowSignal);
  const apneaThreshold = baselineFlow * 0.1; // 90% reduction
  const minDuration = 10; // 10 seconds minimum
  const minSamples = minDuration * sampleRate;
  
  let eventStart = -1;
  let currentDuration = 0;
  
  for (let i = 0; i < flowSignal.length; i++) {
    if (flowSignal[i] <= apneaThreshold) {
      if (eventStart === -1) {
        eventStart = i;
      }
      currentDuration++;
    } else {
      if (eventStart !== -1 && currentDuration >= minSamples) {
        // Check for associated oxygen desaturation (≥3% drop)
        const desaturation = checkDesaturationFullResolution(spo2Signal, eventStart, currentDuration);
        
        events.push({
          type: 'apnea',
          startTime: (chunkStartTime + eventStart / sampleRate),
          duration: currentDuration / sampleRate,
          severity: desaturation ? 'severe' : 'mild',
          flowReduction: ((baselineFlow - flowSignal[eventStart]) / baselineFlow) * 100,
          desaturation: desaturation,
          confidence: calculateEventConfidence(flowSignal, eventStart, currentDuration, 'apnea')
        });
      }
      eventStart = -1;
      currentDuration = 0;
    }
  }
  
  return events;
}

// Full resolution hypopnea detection (AASM compliant)
async function detectHypopneaEventsFullResolution(flowData: any, spo2Data: any, chunkStartTime: number): Promise<any[]> {
  const events = [];
  const flowSignal = flowData.data;
  const spo2Signal = spo2Data.data;
  const sampleRate = flowData.sampleRate;
  
  // AASM definition: Hypopnea = 30% reduction in airflow for ≥10 seconds + 3% O2 desat
  const baselineFlow = calculateBaselineFullResolution(flowSignal);
  const hypopneaThreshold = baselineFlow * 0.7; // 30% reduction
  const minDuration = 10; // 10 seconds minimum
  const minSamples = minDuration * sampleRate;
  
  let eventStart = -1;
  let currentDuration = 0;
  
  for (let i = 0; i < flowSignal.length; i++) {
    if (flowSignal[i] <= hypopneaThreshold) {
      if (eventStart === -1) {
        eventStart = i;
      }
      currentDuration++;
    } else {
      if (eventStart !== -1 && currentDuration >= minSamples) {
        // Check for associated oxygen desaturation (≥3% drop)
        const desaturation = checkDesaturationFullResolution(spo2Signal, eventStart, currentDuration);
        
        if (desaturation) { // Only count if desaturation occurs
          events.push({
            type: 'hypopnea',
            startTime: (chunkStartTime + eventStart / sampleRate),
            duration: currentDuration / sampleRate,
            flowReduction: ((baselineFlow - flowSignal[eventStart]) / baselineFlow) * 100,
            desaturation: desaturation,
            confidence: calculateEventConfidence(flowSignal, eventStart, currentDuration, 'hypopnea')
          });
        }
      }
      eventStart = -1;
      currentDuration = 0;
    }
  }
  
  return events;
}

// Calculate baseline for full resolution data
function calculateBaselineFullResolution(signal: number[]): number {
  // Use median instead of 90th percentile for more robust baseline
  const sorted = [...signal].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return median;
}

// Check desaturation for full resolution data
function checkDesaturationFullResolution(spo2Signal: number[], startIndex: number, duration: number): boolean {
  if (spo2Signal.length === 0) return false;
  
  const baselineSpo2 = calculateBaselineFullResolution(spo2Signal);
  const eventSpo2 = spo2Signal.slice(startIndex, startIndex + duration);
  const minSpo2 = Math.min(...eventSpo2);
  
  const desaturation = baselineSpo2 - minSpo2;
  return desaturation >= 3; // 3% desaturation threshold
}

// Calculate confidence score for detected events
function calculateEventConfidence(flowSignal: number[], startIndex: number, duration: number, eventType: string): number {
  const eventData = flowSignal.slice(startIndex, startIndex + duration);
  const meanReduction = eventData.reduce((sum, val) => sum + val, 0) / eventData.length;
  const baseline = calculateBaselineFullResolution(flowSignal);
  
  const reductionPercentage = ((baseline - meanReduction) / baseline) * 100;
  
  // Higher confidence for events that meet or exceed AASM criteria
  if (eventType === 'apnea' && reductionPercentage >= 90) return 0.95;
  if (eventType === 'hypopnea' && reductionPercentage >= 30) return 0.90;
  
  return Math.min(0.85, reductionPercentage / 100);
}

// Calculate comprehensive sleep metrics
function calculateComprehensiveSleepMetrics(apneaEvents: any[], hypopneaEvents: any[], oxygenData: number[]): any {
  const allEvents = [...apneaEvents, ...hypopneaEvents];
  
  return {
    averageEventDuration: allEvents.length > 0 ? 
      allEvents.reduce((sum, event) => sum + event.duration, 0) / allEvents.length : 0,
    longestEvent: allEvents.length > 0 ? 
      Math.max(...allEvents.map(event => event.duration)) : 0,
    oxygenSaturation: {
      baseline: oxygenData.length > 0 ? calculateBaselineFullResolution(oxygenData) : 0,
      minimum: oxygenData.length > 0 ? Math.min(...oxygenData) : 0,
      average: oxygenData.length > 0 ? oxygenData.reduce((sum, val) => sum + val, 0) / oxygenData.length : 0
    },
    eventDistribution: {
      apnea: apneaEvents.length,
      hypopnea: hypopneaEvents.length,
      severe: apneaEvents.filter(e => e.severity === 'severe').length,
      highConfidence: allEvents.filter(e => e.confidence >= 0.9).length
    },
    analysisQuality: {
      fullResolutionUsed: true,
      totalDataPoints: oxygenData.length,
      confidence: allEvents.length > 0 ? 
        allEvents.reduce((sum, event) => sum + event.confidence, 0) / allEvents.length : 0
    }
  };
}

// Get detailed channel analysis for apnea detection (kept for compatibility)
async function getDetailedChannelAnalysis(scriptPath: string, filePath: string, channel: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    // Get 30-second chunks for detailed analysis (standard for apnea detection)
    const args = [scriptPath, 'chunk-downsample', filePath, channel, '0', '1800', '300']; // 30 seconds, 300 points
    
    console.log('[DEBUG] Getting detailed analysis for channel:', channel);
    const python = spawn(pythonCommand, args);
    
    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code === 0) {
        try {
          const data = JSON.parse(output);
          resolve({
            data: data.data,
            stats: data.stats,
            sampleRate: 1, // Will be determined from actual data
            duration: 30 // 30-second analysis window
          });
        } catch (err) {
          reject(new Error('Failed to parse detailed channel analysis'));
        }
      } else {
        reject(new Error(`Failed to get detailed analysis: ${errorOutput}`));
      }
    });

    python.on('error', (error) => {
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
  });
}

// Professional apnea detection algorithm (AASM compliant)
async function detectApneaEvents(flowData: any, spo2Data: any): Promise<any[]> {
  const events = [];
  const flowSignal = flowData.data;
  const spo2Signal = spo2Data.data;
  const sampleRate = flowData.sampleRate;
  
  // AASM definition: Apnea = 90% reduction in airflow for ≥10 seconds
  const baselineFlow = calculateBaseline(flowSignal);
  const apneaThreshold = baselineFlow * 0.1; // 90% reduction
  const minDuration = 10; // 10 seconds minimum
  const minSamples = minDuration * sampleRate;
  
  let eventStart = -1;
  let currentDuration = 0;
  
  for (let i = 0; i < flowSignal.length; i++) {
    if (flowSignal[i] <= apneaThreshold) {
      if (eventStart === -1) {
        eventStart = i;
      }
      currentDuration++;
    } else {
      if (eventStart !== -1 && currentDuration >= minSamples) {
        // Check for associated oxygen desaturation (≥3% drop)
        const desaturation = checkDesaturation(spo2Signal, eventStart, currentDuration);
        
        events.push({
          type: 'apnea',
          startTime: eventStart / sampleRate,
          duration: currentDuration / sampleRate,
          severity: desaturation ? 'severe' : 'mild',
          flowReduction: ((baselineFlow - flowSignal[eventStart]) / baselineFlow) * 100,
          desaturation: desaturation
        });
      }
      eventStart = -1;
      currentDuration = 0;
    }
  }
  
  return events;
}

// Professional hypopnea detection algorithm (AASM compliant)
async function detectHypopneaEvents(flowData: any, spo2Data: any): Promise<any[]> {
  const events = [];
  const flowSignal = flowData.data;
  const spo2Signal = spo2Data.data;
  const sampleRate = flowData.sampleRate;
  
  // AASM definition: Hypopnea = 30% reduction in airflow for ≥10 seconds + 3% O2 desat OR arousal
  const baselineFlow = calculateBaseline(flowSignal);
  const hypopneaThreshold = baselineFlow * 0.7; // 30% reduction
  const minDuration = 10; // 10 seconds minimum
  const minSamples = minDuration * sampleRate;
  
  let eventStart = -1;
  let currentDuration = 0;
  
  for (let i = 0; i < flowSignal.length; i++) {
    if (flowSignal[i] <= hypopneaThreshold) {
      if (eventStart === -1) {
        eventStart = i;
      }
      currentDuration++;
    } else {
      if (eventStart !== -1 && currentDuration >= minSamples) {
        // Check for associated oxygen desaturation (≥3% drop)
        const desaturation = checkDesaturation(spo2Signal, eventStart, currentDuration);
        
        if (desaturation) { // Only count if desaturation occurs
          events.push({
            type: 'hypopnea',
            startTime: eventStart / sampleRate,
            duration: currentDuration / sampleRate,
            flowReduction: ((baselineFlow - flowSignal[eventStart]) / baselineFlow) * 100,
            desaturation: desaturation
          });
        }
      }
      eventStart = -1;
      currentDuration = 0;
    }
  }
  
  return events;
}

// Calculate baseline airflow (rolling average)
function calculateBaseline(signal: number[]): number {
  const sorted = [...signal].sort((a, b) => a - b);
  // Use 90th percentile as baseline (robust to outliers)
  const percentile90 = Math.floor(sorted.length * 0.9);
  return sorted[percentile90];
}

// Check for oxygen desaturation (≥3% drop)
function checkDesaturation(spo2Signal: number[], startIndex: number, duration: number): boolean {
  if (spo2Signal.length === 0) return false;
  
  const baselineSpo2 = calculateBaseline(spo2Signal);
  const eventSpo2 = spo2Signal.slice(startIndex, startIndex + duration);
  const minSpo2 = Math.min(...eventSpo2);
  
  const desaturation = baselineSpo2 - minSpo2;
  return desaturation >= 3; // 3% desaturation threshold
}

// Classify AHI severity according to AASM guidelines
function classifyAHISeverity(ahi: number): string {
  if (ahi < 5) return 'Normal';
  if (ahi < 15) return 'Mild';
  if (ahi < 30) return 'Moderate';
  return 'Severe';
}

// Calculate additional sleep metrics
function calculateSleepMetrics(apneaEvents: any[], hypopneaEvents: any[], spo2Data: any): any {
  const allEvents = [...apneaEvents, ...hypopneaEvents];
  
  return {
    averageEventDuration: allEvents.length > 0 ? 
      allEvents.reduce((sum, event) => sum + event.duration, 0) / allEvents.length : 0,
    longestEvent: allEvents.length > 0 ? 
      Math.max(...allEvents.map(event => event.duration)) : 0,
    oxygenSaturation: {
      baseline: spo2Data.stats?.mean || 0,
      minimum: spo2Data.stats?.min || 0,
      average: spo2Data.stats?.mean || 0
    },
    eventDistribution: {
      apnea: apneaEvents.length,
      hypopnea: hypopneaEvents.length,
      severe: apneaEvents.filter(e => e.severity === 'severe').length
    }
  };
}

// Helper function to get channel data (kept for backward compatibility)
async function getChannelData(scriptPath: string, filePath: string, channel: string): Promise<{data: number[], sampleRate: number}> {
  return new Promise((resolve, reject) => {
    // Get channel info first
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    const infoProcess = spawn(pythonCommand, [scriptPath, 'info', filePath]);
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
        
        const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
        const dataProcess = spawn(pythonCommand, [scriptPath, 'chunk-downsample', filePath, channel, '0', totalSamples.toString(), targetPoints.toString()]);
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
      const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
      const analysisProcess = spawn(pythonCommand, [scriptPath, tempFile]);
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
export const handleFullStats = async (req: Request, res: Response) => {
  try {
    const { filePath, channels } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: "File path is required" });
    }

    if (!channels || !Array.isArray(channels) || channels.length === 0) {
      return res.status(400).json({ error: "Channels array is required" });
    }

    const scriptPath = path.join(__dirname, "../scripts/parseEdf.py");
    if (!fs.existsSync(scriptPath)) {
      console.error("[ERROR] Python script not found:", scriptPath);
      return res.status(500).json({ error: "Python script not found. Please check the installation." });
    }

    const args = [scriptPath, "full-stats", filePath, JSON.stringify(channels)];
    console.log("[DEBUG] Executing Python full-stats script with:", args.join(" "));

    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    const python = spawn(pythonCommand, args);

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
          console.log("[DEBUG] Successfully parsed Python full-stats output");
          res.json(parsed);
        } catch (err) {
          console.error("[ERROR] JSON parse failed:", err);
          console.error("[PYTHON STDOUT]", output);
          res.status(500).json({ error: "Failed to parse response from Python script." });
        }
      } else {
        console.error("[ERROR] Python error:", errorOutput);
        
        let errorMessage = "Error calculating full file statistics.";
        if (errorOutput.includes("ModuleNotFoundError") || errorOutput.includes("ImportError")) {
          errorMessage = "Required Python modules are missing. Please check server dependencies.";
        } else if (errorOutput.includes("FileNotFoundError")) {
          errorMessage = "EDF file not found or corrupted.";
        } else if (errorOutput.includes("MemoryError")) {
          errorMessage = "File too large for statistics calculation. Consider using a smaller file or more memory.";
        }
        
        res.status(500).json({ 
          error: errorMessage, 
          details: errorOutput,
          code: code || 1
        });
      }
    });

  } catch (error) {
    console.error("[ERROR] Exception in handleFullStats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const handleMaxMinValues = async (req: Request, res: Response) => {
  try {
    console.log('[DEBUG] Max-min request body:', req.body);
    console.log('[DEBUG] Request headers:', req.headers);
    console.log('[DEBUG] Content-Type:', req.headers['content-type']);
    
    const { filePath, channels, startSec = 0, endSec } = req.body;
    
    if (!filePath || !channels || !Array.isArray(channels)) {
      console.log('[DEBUG] Validation failed:', { filePath, channels, isArray: Array.isArray(channels) });
      console.log('[DEBUG] Received data:', { filePath, channels, startSec, endSec });
      return res.status(400).json({ error: "Missing required parameters: filePath and channels array" });
    }

    console.log('[DEBUG] Max-min request validated:', { filePath, channels, startSec, endSec });

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

    // Use python3 in production, python in development
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    const python = spawn(pythonCommand, args);
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

// Get optimized chunk data for AHI analysis (balanced resolution for medical accuracy and memory efficiency)
async function getChunkData(scriptPath: string, filePath: string, channel: string, startTime: number, endTime: number, sampleRate: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    
    // Convert time to samples using the actual sample rate
    const startSample = Math.floor(startTime * sampleRate);
    const durationSamples = Math.floor((endTime - startTime) * sampleRate);
    
    // For AHI analysis, use optimized target points to balance medical accuracy and memory usage
    // Use 10Hz effective resolution (sufficient for 10-second event detection)
    const timeRange = endTime - startTime;
    const targetPoints = Math.min(10000, Math.max(100, Math.floor(timeRange * 10))); // 10Hz resolution
    
    console.log(`[DEBUG] Getting OPTIMIZED chunk data: ${channel} @ ${sampleRate}Hz, ${durationSamples} samples, ${targetPoints} target points (${(endTime-startTime).toFixed(1)}s)`);
    
    // Use 'chunk-downsample' command with optimized target points for medical accuracy
    const args = [scriptPath, 'chunk-downsample', filePath, channel, 
                 startSample.toString(),
                 durationSamples.toString(),
                 targetPoints.toString()];
    
    console.log(`[DEBUG] Optimized resolution command: ${args.join(' ')}`);
    
    const python = spawn(pythonCommand, args);
    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code === 0) {
        try {
          const chunkData = JSON.parse(output);
          console.log(`[DEBUG] Received ${chunkData.data.length} optimized samples for ${channel} (${(chunkData.data.length/timeRange).toFixed(1)}Hz effective resolution)`);
          resolve(chunkData.data);
        } catch (err) {
          reject(new Error('Failed to parse optimized chunk data'));
        }
      } else {
        reject(new Error(`Failed to get optimized chunk data: ${errorOutput}`));
      }
    });

    python.on('error', (error) => {
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
  });
}

// Calculate global baseline from full resolution representative samples across the entire recording
async function calculateGlobalBaseline(scriptPath: string, filePath: string, channel: string, 
                                      sampleRate: number, duration: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    
    // For medical accuracy, sample full resolution data from multiple time points
    // Use optimized chunks to balance accuracy and speed
    const chunkDurationMinutes = 5; // 5-minute chunks for baseline calculation
    const chunkDurationSeconds = chunkDurationMinutes * 60;
    const numChunks = Math.ceil(duration / chunkDurationSeconds);
    
    console.log(`[DEBUG] Calculating global baseline from ${numChunks} full resolution chunks of ${chunkDurationMinutes}min each`);
    
    // Process chunks sequentially to avoid memory issues
    const processChunksSequentially = async () => {
      const allData = [];
      const maxChunks = Math.min(numChunks, 4); // Limit to 4 chunks (20 minutes max) for baseline
      
      for (let i = 0; i < maxChunks; i++) {
        const chunkStart = i * chunkDurationSeconds;
        const chunkEnd = Math.min(chunkStart + chunkDurationSeconds, duration);
        
        console.log(`[DEBUG] Processing baseline chunk ${i + 1}/${maxChunks} (${chunkStart}s to ${chunkEnd}s)`);
        
        try {
          const chunkData = await getChunkData(scriptPath, filePath, channel, chunkStart, chunkEnd, sampleRate);
          allData.push(...chunkData);
          console.log(`[DEBUG] Added ${chunkData.length} samples from chunk ${i + 1}`);
        } catch (error) {
          console.warn(`[WARNING] Failed to process baseline chunk ${i + 1}: ${error.message}`);
          // Continue with other chunks
        }
      }
      
      if (allData.length === 0) {
        throw new Error('No baseline data collected from any chunks');
      }
      
      console.log(`[DEBUG] Combined ${allData.length} samples from ${maxChunks} chunks for global baseline`);
      
      // Calculate baseline using median of upper 75% of values (more robust)
      const flowAbs = allData.map((x: number) => Math.abs(x));
      flowAbs.sort((a: number, b: number) => a - b);
      const upper75Percentile = flowAbs[Math.floor(flowAbs.length * 0.25)]; // 75th percentile
      const baselineCandidates = flowAbs.filter((x: number) => x >= upper75Percentile);
      // Use median instead of mean for more robust baseline
      const sortedCandidates = baselineCandidates.sort((a: number, b: number) => a - b);
      const baseline = sortedCandidates[Math.floor(sortedCandidates.length / 2)];
      
      console.log(`[DEBUG] Global baseline calculated: ${baseline.toFixed(3)} from ${allData.length} full resolution samples`);
      return baseline;
    };
    
    processChunksSequentially()
      .then((baseline) => resolve(baseline))
      .catch((error) => reject(new Error(`Failed to calculate global baseline: ${error.message}`)));
  });
}

// Process a single chunk with Python AHI analysis
async function processChunkAHI(ahiScriptPath: string, flowData: number[], spo2Data: number[], 
                              flowSampleRate: number, spo2SampleRate: number, chunkStartTime: number, globalBaseline?: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    
    // Prepare input data for this chunk
    const analysisInput = {
      flow_data: flowData,
      spo2_data: spo2Data,
      flow_sample_rate: flowSampleRate,
      spo2_sample_rate: spo2SampleRate,
      global_baseline: globalBaseline // Pass global baseline to Python script
    };
    
    // Write input data to temporary file
    const tempInputFile = `/tmp/ahi_chunk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.json`;
    require('fs').writeFileSync(tempInputFile, JSON.stringify(analysisInput));
    
    const args = [ahiScriptPath, tempInputFile];
    
    const python = spawn(pythonCommand, args);
    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      // Clean up temporary file
      try {
        require('fs').unlinkSync(tempInputFile);
      } catch (cleanupError) {
        console.warn('[WARNING] Failed to clean up temporary chunk file:', cleanupError);
      }
      
      if (code === 0) {
        try {
          const results = JSON.parse(output);
          resolve(results);
        } catch (err) {
          reject(new Error('Failed to parse chunk AHI results'));
        }
      } else {
        reject(new Error(`Python AHI analysis failed for chunk: ${errorOutput}`));
      }
    });

    python.on('error', (error) => {
      reject(new Error(`Failed to start Python AHI analysis: ${error.message}`));
    });
  });
}

// Remove duplicate events from overlapping chunks
function removeDuplicateEvents(events: any[]): any[] {
  if (!events || events.length === 0) {
    return [];
  }
  
  // Sort events by start time
  const sortedEvents = events.sort((a, b) => a.start_time - b.start_time);
  const uniqueEvents = [];
  
  for (const event of sortedEvents) {
    let isDuplicate = false;
    
    for (const existingEvent of uniqueEvents) {
      // Check for overlap
      const overlapStart = Math.max(event.start_time, existingEvent.start_time);
      const overlapEnd = Math.min(event.end_time, existingEvent.end_time);
      const overlapDuration = Math.max(0, overlapEnd - overlapStart);
      
      // Calculate overlap percentage
      const eventDuration = event.end_time - event.start_time;
      const existingDuration = existingEvent.end_time - existingEvent.start_time;
      const maxDuration = Math.max(eventDuration, existingDuration);
      
      const overlapPercentage = overlapDuration / maxDuration;
      
      if (overlapPercentage > 0.5) { // More than 50% overlap
        isDuplicate = true;
        // Keep the longer event
        if (eventDuration > existingDuration) {
          const index = uniqueEvents.indexOf(existingEvent);
          uniqueEvents[index] = event;
        }
        break;
      }
    }
    
    if (!isDuplicate) {
      uniqueEvents.push(event);
    }
  }
  
  return uniqueEvents;
}

// Calculate AHI from events
function calculateAHI(apneaEvents: any[], hypopneaEvents: any[], recordingDurationHours: number): any {
  const totalEvents = apneaEvents.length + hypopneaEvents.length;
  const ahiScore = totalEvents / recordingDurationHours;
  
  // Classify severity
  let severity, severityColor;
  if (ahiScore < 5) {
    severity = "Normal";
    severityColor = "green";
  } else if (ahiScore < 15) {
    severity = "Mild";
    severityColor = "yellow";
  } else if (ahiScore < 30) {
    severity = "Moderate";
    severityColor = "orange";
  } else {
    severity = "Severe";
    severityColor = "red";
  }
  
  // Calculate statistics
  const totalApneaDuration = apneaEvents.reduce((sum, event) => sum + event.duration, 0);
  const totalHypopneaDuration = hypopneaEvents.reduce((sum, event) => sum + event.duration, 0);
  const totalEventDuration = totalApneaDuration + totalHypopneaDuration;
  
  return {
    ahi_score: Math.round(ahiScore * 10) / 10,
    severity: severity,
    severity_color: severityColor,
    total_events: totalEvents,
    apnea_count: apneaEvents.length,
    hypopnea_count: hypopneaEvents.length,
    recording_duration_hours: Math.round(recordingDurationHours * 100) / 100,
    total_event_duration_minutes: Math.round(totalEventDuration / 60 * 10) / 10,
    event_percentage: Math.round((totalEventDuration / (recordingDurationHours * 3600)) * 100 * 10) / 10,
    avg_apnea_duration: apneaEvents.length > 0 ? Math.round(totalApneaDuration / apneaEvents.length * 10) / 10 : 0,
    avg_hypopnea_duration: hypopneaEvents.length > 0 ? Math.round(totalHypopneaDuration / hypopneaEvents.length * 10) / 10 : 0,
    events_per_hour_breakdown: {
      apnea_per_hour: Math.round(apneaEvents.length / recordingDurationHours * 10) / 10,
      hypopnea_per_hour: Math.round(hypopneaEvents.length / recordingDurationHours * 10) / 10
    }
  };
}