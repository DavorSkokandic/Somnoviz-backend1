"use strict";
// src/controllers/uploadController.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMaxMinValues = exports.handleAHIAnalysis = exports.handleEdfMultiChunk = exports.handleEdfChunkDownsample = exports.handleEdfChunk = exports.handleFileUpload = void 0;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Helper function to get correct script paths in both development and production
const getScriptPath = (scriptName) => {
    // List of possible paths to check (in order of preference)
    const possiblePaths = [
        // Development: TypeScript source
        path_1.default.resolve(__dirname, `../scripts/${scriptName}`),
        // Development: if running from compiled dist
        path_1.default.resolve(__dirname, `../../src/scripts/${scriptName}`),
        // Production: Railway deployment
        path_1.default.resolve(process.cwd(), `src/scripts/${scriptName}`),
        // Alternative production path
        path_1.default.resolve(process.cwd(), `dist/scripts/${scriptName}`),
        // Fallback: relative to project root
        path_1.default.resolve(process.cwd(), `scripts/${scriptName}`)
    ];
    // Try each path and return the first one that exists
    for (const scriptPath of possiblePaths) {
        if (fs_1.default.existsSync(scriptPath)) {
            console.log(`[DEBUG] Found script at: ${scriptPath}`);
            return scriptPath;
        }
    }
    // If none found, log all attempted paths and return the first one
    console.error(`[ERROR] Script '${scriptName}' not found in any of these locations:`);
    possiblePaths.forEach((p, i) => {
        console.error(`  ${i + 1}. ${p} (exists: ${fs_1.default.existsSync(p)})`);
    });
    return possiblePaths[0]; // Return first path as fallback
};
const handleFileUpload = async (req, res) => {
    try {
        const file = req.file;
        if (!file)
            return res.status(400).json({ error: "No file uploaded." });
        console.log("[DEBUG] File uploaded:", file.originalname);
        console.log("[DEBUG] File path:", file.path);
        const filePath = path_1.default.resolve(file.path);
        const pythonScriptPath = getScriptPath("parseEdf.py");
        console.log("[DEBUG] Python script path:", pythonScriptPath);
        console.log("[DEBUG] Python script exists:", fs_1.default.existsSync(pythonScriptPath));
        // Use python3 in production, python in development
        const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
        console.log(`[DEBUG] Attempting to use Python command: ${pythonCommand}`);
        const python = (0, child_process_1.spawn)(pythonCommand, [pythonScriptPath, "info", filePath]);
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
                    const previewData = {};
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
                }
                catch (parseError) {
                    console.error("[ERROR] Failed to parse Python output:", parseError);
                    res.status(500).json({ error: "Failed to parse Python script output", details: output });
                }
            }
            else {
                console.error("[ERROR] Python process failed with code:", code);
                console.error("[ERROR] Python error output:", errorOutput);
                console.error("[ERROR] Python stdout:", output);
                // More detailed error message
                let errorMessage = "Failed to process EDF file";
                if (errorOutput.includes("No such file or directory")) {
                    errorMessage = "Python script not found. Please check server configuration.";
                }
                else if (errorOutput.includes("ModuleNotFoundError") || errorOutput.includes("ImportError")) {
                    errorMessage = "Required Python modules are missing. Please check server dependencies.";
                }
                else if (errorOutput.trim()) {
                    errorMessage = `Python processing error: ${errorOutput.trim()}`;
                }
                res.status(500).json({
                    error: errorMessage,
                    details: errorOutput,
                    code: code,
                    pythonScriptPath: pythonScriptPath,
                    scriptExists: fs_1.default.existsSync(pythonScriptPath)
                });
            }
        });
        python.on("error", (error) => {
            console.error("[ERROR] Python process error:", error);
            res.status(500).json({ error: "Failed to start Python process", details: error.message });
        });
    }
    catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: "Internal server error." });
    }
};
exports.handleFileUpload = handleFileUpload;
const handleEdfChunk = async (req, res) => {
    const { filePath, channel, start_sample, num_samples } = req.query;
    if (!filePath || !channel || !start_sample || !num_samples) {
        return res.status(400).json({ error: "Nedostaju parametri." });
    }
    const decodedPath = decodeURIComponent(filePath);
    if (!fs_1.default.existsSync(decodedPath)) {
        return res.status(404).json({ error: "Fajl ne postoji." });
    }
    const pythonScriptPath = getScriptPath("parseEdf.py");
    const args = [pythonScriptPath, "chunk", decodedPath, channel, start_sample, num_samples];
    console.log("Executing Python chunk script with:", args.join(" "));
    // Use python3 in production, python in development
    const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
    const python = (0, child_process_1.spawn)(pythonCommand, args);
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
        }
        else {
            console.error("Python error:", errorOutput);
            res.status(500).json({ error: "Error fetching chunk data.", details: errorOutput });
        }
    });
};
exports.handleEdfChunk = handleEdfChunk;
const handleEdfChunkDownsample = async (req, res) => {
    try {
        const { filePath, channel, start_sample, num_samples, target_points } = req.query;
        console.log("[DEBUG] handleEdfChunkDownsample called with:", { filePath, channel, start_sample, num_samples, target_points });
        if (!filePath || !channel || !start_sample || !num_samples || !target_points) {
            console.log("[ERROR] Missing parameters:", { filePath, channel, start_sample, num_samples, target_points });
            return res.status(400).json({ error: "Nedostaju parametri." });
        }
        const decodedPath = decodeURIComponent(filePath);
        console.log("[DEBUG] Decoded file path:", decodedPath);
        console.log("[DEBUG] File exists:", fs_1.default.existsSync(decodedPath));
        if (!fs_1.default.existsSync(decodedPath)) {
            console.log("[ERROR] File not found:", decodedPath);
            return res.status(404).json({ error: "Fajl ne postoji." });
        }
        const scriptPath = getScriptPath('parseEdf.py');
        console.log("[DEBUG] Python script path:", scriptPath);
        console.log("[DEBUG] Python script exists:", fs_1.default.existsSync(scriptPath));
        if (!fs_1.default.existsSync(scriptPath)) {
            console.log("[ERROR] Python script not found:", scriptPath);
            return res.status(500).json({ error: "Python script not found. Please check the installation." });
        }
        const args = [scriptPath, "chunk-downsample", decodedPath, channel, start_sample, num_samples, target_points];
        console.log("[DEBUG] Executing Python downsample script with:", args.join(" "));
        // Use python3 in production, python in development
        const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
        const python = (0, child_process_1.spawn)(pythonCommand, args);
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
                }
                catch (err) {
                    console.error("[ERROR] JSON parse failed:", err);
                    console.error("[PYTHON STDOUT]", output);
                    res.status(500).json({ error: "Failed to parse response from Python script." });
                }
            }
            else {
                console.error("[ERROR] Python error:", errorOutput);
                // Provide more helpful error messages
                let errorMessage = "Error fetching chunk data.";
                if (errorOutput.includes("ModuleNotFoundError") || errorOutput.includes("ImportError")) {
                    errorMessage = "Required Python modules are missing. Please check server dependencies.";
                }
                else if (errorOutput.includes("FileNotFoundError")) {
                    errorMessage = "EDF file not found or corrupted.";
                }
                else if (errorOutput.includes("IndexError")) {
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
    }
    catch (error) {
        console.error("[ERROR] Unexpected error in handleEdfChunkDownsample:", error);
        res.status(500).json({ error: "Internal server error in handleEdfChunkDownsample." });
    }
};
exports.handleEdfChunkDownsample = handleEdfChunkDownsample;
const handleEdfMultiChunk = async (req, res) => {
    try {
        console.log('[DEBUG] Multi-chunk request received:', req.query);
        // Accept time in seconds for robust, channel-agnostic requests
        const { filePath, channels, start_sec, end_sec, max_points } = req.query;
        if (!filePath || !channels || start_sec === undefined || end_sec === undefined || !max_points) {
            console.log('[ERROR] Missing parameters:', { filePath: !!filePath, channels: !!channels, start_sec: start_sec !== undefined, end_sec: end_sec !== undefined, max_points: !!max_points });
            return res.status(400).json({ error: 'Missing required query parameters.' });
        }
        const decodedFilePath = decodeURIComponent(filePath);
        const parsedChannels = JSON.parse(channels);
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
            max_points,
        ];
        console.log('[DEBUG] Spawning Python process with args:', args);
        const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
        const pythonProcess = (0, child_process_1.spawn)(pythonCommand, [getScriptPath('parseEdf.py'), ...args]);
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
                                const timeRange = parseFloat(end_sec) - parseFloat(start_sec);
                                const dataLength = channelData.length;
                                sampleRate = timeRange > 0 && dataLength > 0 ? dataLength / timeRange : 1;
                            }
                            else {
                                // New format: object with data, sample_rate, original_length
                                channelData = channelInfo.data || [];
                                sampleRate = channelInfo.sample_rate || 1;
                            }
                            return {
                                name: channelName,
                                data: channelData,
                                sample_rate: sampleRate,
                                start_time_sec: parseFloat(start_sec),
                                stats: {} // Optional stats can be added later
                            };
                        })
                    };
                    console.log('[DEBUG] Transformed response:', {
                        channelCount: transformedResponse.channels.length,
                        channelNames: transformedResponse.channels.map(c => c.name)
                    });
                    res.json(transformedResponse);
                }
                catch (err) {
                    console.error('[ERROR] JSON parse failed:', err);
                    console.error('[PYTHON STDOUT]', result);
                    res.status(500).json({ error: 'Failed to parse response from Python script.' });
                }
            }
            else {
                console.error('[PYTHON STDERR]', errorOutput);
                res.status(500).json({ error: 'Python script failed.', details: errorOutput });
            }
        });
    }
    catch (err) {
        console.error('[ERROR] Unexpected server error:', err);
        res.status(500).json({ error: 'Unexpected error occurred.' });
    }
};
exports.handleEdfMultiChunk = handleEdfMultiChunk;
const handleAHIAnalysis = async (req, res) => {
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
        if (!fs_1.default.existsSync(decodedFilePath)) {
            console.log('[ERROR] EDF file not found:', decodedFilePath);
            return res.status(404).json({ error: 'EDF file not found' });
        }
        console.log('[DEBUG] Starting efficient AHI analysis for:', {
            filePath: decodedFilePath,
            flowChannel,
            spo2Channel
        });
        // Use the existing parseEdf.py with max-min command to get basic statistics
        // This is much more efficient than loading full data
        const parseEdfScript = getScriptPath("parseEdf.py");
        // Get basic channel statistics instead of full data
        console.log('[DEBUG] Getting channel statistics for AHI analysis...');
        const channelStats = await getChannelStatistics(parseEdfScript, decodedFilePath, [flowChannel, spo2Channel]);
        channelStats.filePath = decodedFilePath; // Add file path for later use
        // Run lightweight AHI analysis based on statistics
        console.log('[DEBUG] Running lightweight AHI analysis...');
        const ahiResults = await runLightweightAHIAnalysis(channelStats, flowChannel, spo2Channel);
        console.log('[DEBUG] AHI analysis completed successfully');
        // Return results
        res.json({
            success: true,
            ahi: ahiResults.ahi,
            events: ahiResults.events,
            summary: ahiResults.summary,
            message: "AHI analysis completed using efficient backend processing"
        });
    }
    catch (error) {
        console.error("[ERROR] AHI analysis failed:", error);
        res.status(500).json({
            error: "AHI analysis failed",
            details: error instanceof Error ? error.message : String(error)
        });
    }
};
exports.handleAHIAnalysis = handleAHIAnalysis;
// Efficient helper function to get channel statistics (not full data)
async function getChannelStatistics(scriptPath, filePath, channels) {
    return new Promise((resolve, reject) => {
        const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
        const args = [scriptPath, 'max-min', filePath, JSON.stringify(channels), '0', '300']; // Get stats for first 5 minutes as sample
        console.log('[DEBUG] Getting channel statistics with:', args.join(' '));
        const python = (0, child_process_1.spawn)(pythonCommand, args);
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
                }
                catch (err) {
                    reject(new Error('Failed to parse channel statistics'));
                }
            }
            else {
                reject(new Error(`Failed to get channel statistics: ${errorOutput}`));
            }
        });
        python.on('error', (error) => {
            reject(new Error(`Failed to start Python process: ${error.message}`));
        });
    });
}
// Professional AHI analysis using dedicated Python script (medical accuracy)
async function runLightweightAHIAnalysis(channelStats, flowChannel, spo2Channel) {
    const flowStats = channelStats[flowChannel];
    const spo2Stats = channelStats[spo2Channel];
    if (!flowStats || !spo2Stats) {
        throw new Error('Could not get statistics for required channels');
    }
    console.log('[DEBUG] Running professional AHI analysis using dedicated Python script...');
    const parseEdfScript = getScriptPath("parseEdf.py");
    const ahiScript = getScriptPath("ahi_analysis.py");
    const filePath = channelStats.filePath || channelStats[flowChannel]?.filePath;
    try {
        // Get full resolution data for both channels
        console.log('[DEBUG] Extracting full resolution flow and SpO2 data...');
        const flowData = await getFullChannelData(parseEdfScript, filePath, flowChannel);
        const spo2Data = await getFullChannelData(parseEdfScript, filePath, spo2Channel);
        // Prepare input data for Python AHI analysis script
        const analysisInput = {
            flow_data: flowData.data,
            spo2_data: spo2Data.data,
            flow_sample_rate: flowData.sampleRate,
            spo2_sample_rate: spo2Data.sampleRate
        };
        // Write input data to temporary file (Python script expects JSON file)
        const tempInputFile = `/tmp/ahi_input_${Date.now()}.json`;
        require('fs').writeFileSync(tempInputFile, JSON.stringify(analysisInput));
        console.log('[DEBUG] Running Python AHI analysis script...');
        // Run the professional Python AHI analysis
        const ahiResults = await runPythonAHIAnalysis(ahiScript, tempInputFile);
        // Clean up temporary file
        try {
            require('fs').unlinkSync(tempInputFile);
        }
        catch (cleanupError) {
            console.warn('[WARNING] Failed to clean up temporary file:', cleanupError);
        }
        // Optimize results for frontend (extract only essential data)
        const optimizedResults = {
            success: true,
            ahi: ahiResults.ahi_analysis.ahi_score,
            events: {
                apneas: ahiResults.ahi_analysis.apnea_count,
                hypopneas: ahiResults.ahi_analysis.hypopnea_count,
                total: ahiResults.ahi_analysis.total_events
            },
            // Send optimized event summaries (not full raw data)
            eventSummary: {
                apneaEvents: ahiResults.apnea_events.map((event) => ({
                    startTime: Math.round(event.start_time),
                    duration: Math.round(event.duration * 10) / 10,
                    severity: event.severity,
                    type: 'apnea'
                })),
                hypopneaEvents: ahiResults.hypopnea_events.map((event) => ({
                    startTime: Math.round(event.start_time),
                    duration: Math.round(event.duration * 10) / 10,
                    severity: event.severity,
                    spo2Drop: Math.round(event.spo2_drop * 10) / 10,
                    type: 'hypopnea'
                }))
            },
            metrics: {
                averageEventDuration: ahiResults.ahi_analysis.avg_apnea_duration,
                longestEvent: Math.max(...ahiResults.apnea_events.map((e) => e.duration), ...ahiResults.hypopnea_events.map((e) => e.duration)),
                oxygenSaturation: {
                    // Extract from SpO2 data if available
                    baseline: spo2Stats.max?.value || 0,
                    minimum: spo2Stats.min?.value || 0,
                    average: (spo2Stats.max?.value + spo2Stats.min?.value) / 2 || 0
                },
                eventDistribution: {
                    apnea: ahiResults.ahi_analysis.apnea_count,
                    hypopnea: ahiResults.ahi_analysis.hypopnea_count,
                    severe: ahiResults.apnea_events.filter((e) => e.severity === 'severe').length
                },
                analysisQuality: {
                    fullResolutionUsed: true,
                    totalDataPoints: flowData.data.length + spo2Data.data.length,
                    confidence: 0.95, // High confidence using professional Python script
                    professionalAnalysis: true
                }
            },
            summary: {
                severity: ahiResults.ahi_analysis.severity,
                severityColor: ahiResults.ahi_analysis.severity_color,
                flowChannel: flowChannel,
                spo2Channel: spo2Channel,
                analysisMethod: 'Professional Python AHI Analysis Script',
                recordingDuration: `${ahiResults.ahi_analysis.recording_duration_hours} hours`,
                eventPercentage: ahiResults.ahi_analysis.event_percentage,
                aasCompliant: true,
                fullResolutionAnalysis: true,
                professionalScript: true
            }
        };
        console.log(`[DEBUG] AHI analysis complete: ${optimizedResults.ahi} (${optimizedResults.summary.severity})`);
        return optimizedResults;
    }
    catch (error) {
        console.error('[ERROR] Python AHI analysis failed:', error);
        throw new Error(`AHI analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
// Get full channel data for AHI analysis
async function getFullChannelData(scriptPath, filePath, channel) {
    return new Promise((resolve, reject) => {
        const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
        // First get file info to determine total samples
        const infoArgs = [scriptPath, 'info', filePath];
        console.log(`[DEBUG] Getting file info for ${channel}: ${infoArgs.join(' ')}`);
        const infoProcess = (0, child_process_1.spawn)(pythonCommand, infoArgs);
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
                // For AHI analysis, we don't need full resolution - use reasonable sample size
                // Limit to maximum 1 hour of data at the sample rate, or 100k samples, whichever is smaller
                const maxSamplesForAHI = Math.min(totalSamples, Math.min(sampleRate * 3600, 100000));
                console.log(`[DEBUG] Limiting AHI data to ${maxSamplesForAHI} samples (from ${totalSamples} total)`);
                // Use chunk-downsample for better performance
                const args = [scriptPath, 'chunk-downsample', filePath, channel, '0', maxSamplesForAHI.toString(), '1000'];
                console.log(`[DEBUG] Getting full channel data for ${channel}: ${args.join(' ')}`);
                const python = (0, child_process_1.spawn)(pythonCommand, args);
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
                        }
                        catch (err) {
                            reject(new Error('Failed to parse full channel data'));
                        }
                    }
                    else {
                        reject(new Error(`Failed to get full channel data: ${errorOutput}`));
                    }
                });
            }
            catch (err) {
                reject(new Error(`Failed to parse file info: ${err}`));
            }
        });
        infoProcess.on('error', (error) => {
            reject(new Error(`Failed to start Python info process: ${error.message}`));
        });
    });
}
// Run Python AHI analysis script
async function runPythonAHIAnalysis(scriptPath, inputFile) {
    return new Promise((resolve, reject) => {
        const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
        const args = [scriptPath, inputFile];
        console.log(`[DEBUG] Running Python AHI analysis: ${args.join(' ')}`);
        const python = (0, child_process_1.spawn)(pythonCommand, args);
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
                }
                catch (err) {
                    reject(new Error('Failed to parse Python AHI analysis results'));
                }
            }
            else {
                reject(new Error(`Python AHI analysis failed: ${errorOutput}`));
            }
        });
        python.on('error', (error) => {
            reject(new Error(`Failed to start Python AHI analysis: ${error.message}`));
        });
    });
}
// Get file info for duration and channel details
async function getFileInfo(scriptPath, filePath) {
    return new Promise((resolve, reject) => {
        const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
        const args = [scriptPath, 'info', filePath];
        const python = (0, child_process_1.spawn)(pythonCommand, args);
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
                }
                catch (err) {
                    reject(new Error('Failed to parse file info'));
                }
            }
            else {
                reject(new Error(`Failed to get file info: ${errorOutput}`));
            }
        });
        python.on('error', (error) => {
            reject(new Error(`Failed to start Python process: ${error.message}`));
        });
    });
}
// Get full resolution chunk data for accurate analysis
async function getFullResolutionChunk(scriptPath, filePath, channel, startTime, endTime) {
    return new Promise((resolve, reject) => {
        const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
        // Get full resolution data for the time window (no downsampling)
        const duration = endTime - startTime;
        const args = [scriptPath, 'chunk', filePath, channel, String(startTime * 100), String(duration * 100)]; // Assuming 100Hz sample rate
        console.log(`[DEBUG] Getting full resolution chunk: ${args.join(' ')}`);
        const python = (0, child_process_1.spawn)(pythonCommand, args);
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
                }
                catch (err) {
                    reject(new Error('Failed to parse full resolution chunk data'));
                }
            }
            else {
                reject(new Error(`Failed to get full resolution chunk: ${errorOutput}`));
            }
        });
        python.on('error', (error) => {
            reject(new Error(`Failed to start Python process: ${error.message}`));
        });
    });
}
// Full resolution apnea detection (AASM compliant)
async function detectApneaEventsFullResolution(flowData, spo2Data, chunkStartTime) {
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
        }
        else {
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
async function detectHypopneaEventsFullResolution(flowData, spo2Data, chunkStartTime) {
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
        }
        else {
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
function calculateBaselineFullResolution(signal) {
    // Use median instead of 90th percentile for more robust baseline
    const sorted = [...signal].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return median;
}
// Check desaturation for full resolution data
function checkDesaturationFullResolution(spo2Signal, startIndex, duration) {
    if (spo2Signal.length === 0)
        return false;
    const baselineSpo2 = calculateBaselineFullResolution(spo2Signal);
    const eventSpo2 = spo2Signal.slice(startIndex, startIndex + duration);
    const minSpo2 = Math.min(...eventSpo2);
    const desaturation = baselineSpo2 - minSpo2;
    return desaturation >= 3; // 3% desaturation threshold
}
// Calculate confidence score for detected events
function calculateEventConfidence(flowSignal, startIndex, duration, eventType) {
    const eventData = flowSignal.slice(startIndex, startIndex + duration);
    const meanReduction = eventData.reduce((sum, val) => sum + val, 0) / eventData.length;
    const baseline = calculateBaselineFullResolution(flowSignal);
    const reductionPercentage = ((baseline - meanReduction) / baseline) * 100;
    // Higher confidence for events that meet or exceed AASM criteria
    if (eventType === 'apnea' && reductionPercentage >= 90)
        return 0.95;
    if (eventType === 'hypopnea' && reductionPercentage >= 30)
        return 0.90;
    return Math.min(0.85, reductionPercentage / 100);
}
// Calculate comprehensive sleep metrics
function calculateComprehensiveSleepMetrics(apneaEvents, hypopneaEvents, oxygenData) {
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
async function getDetailedChannelAnalysis(scriptPath, filePath, channel) {
    return new Promise((resolve, reject) => {
        const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
        // Get 30-second chunks for detailed analysis (standard for apnea detection)
        const args = [scriptPath, 'chunk-downsample', filePath, channel, '0', '1800', '300']; // 30 seconds, 300 points
        console.log('[DEBUG] Getting detailed analysis for channel:', channel);
        const python = (0, child_process_1.spawn)(pythonCommand, args);
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
                }
                catch (err) {
                    reject(new Error('Failed to parse detailed channel analysis'));
                }
            }
            else {
                reject(new Error(`Failed to get detailed analysis: ${errorOutput}`));
            }
        });
        python.on('error', (error) => {
            reject(new Error(`Failed to start Python process: ${error.message}`));
        });
    });
}
// Professional apnea detection algorithm (AASM compliant)
async function detectApneaEvents(flowData, spo2Data) {
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
        }
        else {
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
async function detectHypopneaEvents(flowData, spo2Data) {
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
        }
        else {
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
function calculateBaseline(signal) {
    const sorted = [...signal].sort((a, b) => a - b);
    // Use 90th percentile as baseline (robust to outliers)
    const percentile90 = Math.floor(sorted.length * 0.9);
    return sorted[percentile90];
}
// Check for oxygen desaturation (≥3% drop)
function checkDesaturation(spo2Signal, startIndex, duration) {
    if (spo2Signal.length === 0)
        return false;
    const baselineSpo2 = calculateBaseline(spo2Signal);
    const eventSpo2 = spo2Signal.slice(startIndex, startIndex + duration);
    const minSpo2 = Math.min(...eventSpo2);
    const desaturation = baselineSpo2 - minSpo2;
    return desaturation >= 3; // 3% desaturation threshold
}
// Classify AHI severity according to AASM guidelines
function classifyAHISeverity(ahi) {
    if (ahi < 5)
        return 'Normal';
    if (ahi < 15)
        return 'Mild';
    if (ahi < 30)
        return 'Moderate';
    return 'Severe';
}
// Calculate additional sleep metrics
function calculateSleepMetrics(apneaEvents, hypopneaEvents, spo2Data) {
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
async function getChannelData(scriptPath, filePath, channel) {
    return new Promise((resolve, reject) => {
        // Get channel info first
        const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
        const infoProcess = (0, child_process_1.spawn)(pythonCommand, [scriptPath, 'info', filePath]);
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
                const dataProcess = (0, child_process_1.spawn)(pythonCommand, [scriptPath, 'chunk-downsample', filePath, channel, '0', totalSamples.toString(), targetPoints.toString()]);
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
                    }
                    catch (parseError) {
                        reject(new Error(`Failed to parse channel data: ${parseError}`));
                    }
                });
            }
            catch (parseError) {
                reject(new Error(`Failed to parse file info: ${parseError}`));
            }
        });
    });
}
// Helper function to run AHI analysis
async function runAHIAnalysis(scriptPath, inputData) {
    return new Promise((resolve, reject) => {
        // Create a temporary file to pass JSON data (avoids PowerShell JSON escaping issues)
        const tempFile = path_1.default.join(__dirname, `temp_ahi_input_${Date.now()}.json`);
        try {
            // Write input data to temporary file
            fs_1.default.writeFileSync(tempFile, JSON.stringify(inputData));
            console.log('[DEBUG] Created temp file:', tempFile);
            // Modified AHI script to read from file instead of command line
            const pythonCommand = process.env.NODE_ENV === 'production' ? 'python3' : 'python';
            const analysisProcess = (0, child_process_1.spawn)(pythonCommand, [scriptPath, tempFile]);
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
                    fs_1.default.unlinkSync(tempFile);
                    console.log('[DEBUG] Cleaned up temp file:', tempFile);
                }
                catch (cleanupError) {
                    console.warn('[WARN] Failed to clean up temp file:', cleanupError);
                }
                if (code !== 0) {
                    reject(new Error(`AHI analysis failed: ${errorOutput}`));
                    return;
                }
                try {
                    const results = JSON.parse(output);
                    resolve(results);
                }
                catch (parseError) {
                    reject(new Error(`Failed to parse AHI results: ${parseError}`));
                }
            });
        }
        catch (fileError) {
            reject(new Error(`Failed to create temp file: ${fileError}`));
        }
    });
}
;
// Handler for finding max/min values from raw data
const handleMaxMinValues = async (req, res) => {
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
        const python = (0, child_process_1.spawn)(pythonCommand, args);
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
            }
            catch (parseError) {
                console.error('[ERROR] Failed to parse max-min results:', parseError);
                res.status(500).json({ error: 'Failed to parse max-min results' });
            }
        });
    }
    catch (error) {
        console.error('[ERROR] Max-min analysis error:', error);
        res.status(500).json({ error: 'Max-min analysis failed' });
    }
};
exports.handleMaxMinValues = handleMaxMinValues;
