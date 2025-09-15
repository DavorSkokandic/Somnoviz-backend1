"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// server.ts
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors")); // Ispravan import
const dotenv_1 = __importDefault(require("dotenv")); // Ispravan import
const upload_1 = __importDefault(require("./routes/upload"));
const fileCleanupService_1 = require("./services/fileCleanupService");
const cleanup_config_1 = __importDefault(require("./config/cleanup.config"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
// Configure CORS for development and production
const corsOptions = {
    origin: process.env.NODE_ENV === 'production'
        ? [
            'https://somnoviz.netlify.app',
            'https://main--somnoviz.netlify.app',
            /https:\/\/.*--somnoviz\.netlify\.app$/,
            /https:\/\/.*\.netlify\.app$/
        ] // Production origins - your Netlify URL
        : ["http://localhost:5173", "http://localhost:3000"], // Development origins
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    optionsSuccessStatus: 200 // For legacy browser support
};
app.use((0, cors_1.default)(corsOptions));
app.use(express_1.default.json()); // Za parsiranje JSON tijela zahtjeva
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
        const scriptPath = process.env.NODE_ENV === 'production'
            ? path.resolve(process.cwd(), 'src/scripts/test_python.py')
            : path.resolve(__dirname, 'scripts/test_python.py');
        const python = spawn('python', [scriptPath]);
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
                    const result = JSON.parse(output);
                    res.json(result);
                }
                catch (err) {
                    res.json({
                        success: false,
                        error: 'Failed to parse Python test output',
                        output,
                        errorOutput
                    });
                }
            }
            else {
                res.json({
                    success: false,
                    error: 'Python test failed',
                    code,
                    errorOutput
                });
            }
        });
        python.on('error', (error) => {
            res.json({
                success: false,
                error: 'Failed to start Python process',
                details: error.message
            });
        });
    }
    catch (error) {
        res.json({
            success: false,
            error: 'Server error during Python test',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});
app.use("/api/upload", upload_1.default); // Montira vašu rutu
// Add cleanup status endpoint
app.get('/api/cleanup/stats', async (_req, res) => {
    try {
        const stats = await fileCleanupService_1.fileCleanupService.getStats();
        res.json({
            success: true,
            stats,
            config: {
                maxAgeHours: cleanup_config_1.default.maxAgeHours,
                uploadDir: cleanup_config_1.default.uploadDir,
                intervalMinutes: cleanup_config_1.default.intervalMinutes,
                enabled: cleanup_config_1.default.enabled
            }
        });
    }
    catch (error) {
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
        const result = await fileCleanupService_1.fileCleanupService.manualCleanup();
        res.json({
            success: true,
            ...result
        });
    }
    catch (error) {
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
    if (cleanup_config_1.default.enabled) {
        console.log(`[FileCleanup] Configuration:`);
        console.log(`  - Max file age: ${cleanup_config_1.default.maxAgeHours} hours`);
        console.log(`  - Cleanup interval: ${cleanup_config_1.default.intervalMinutes} minutes`);
        console.log(`  - Upload directory: ${cleanup_config_1.default.uploadDir}`);
        // Initialize service with config
        fileCleanupService_1.fileCleanupService.updateConfig(cleanup_config_1.default.maxAgeHours);
        fileCleanupService_1.fileCleanupService.start(cleanup_config_1.default.intervalMinutes);
    }
    else {
        console.log(`[FileCleanup] Automatic cleanup is disabled`);
    }
    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nReceived SIGINT. Graceful shutdown...');
        fileCleanupService_1.fileCleanupService.stop();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        console.log('\nReceived SIGTERM. Graceful shutdown...');
        fileCleanupService_1.fileCleanupService.stop();
        process.exit(0);
    });
});
