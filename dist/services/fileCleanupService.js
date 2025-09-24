"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileCleanupService = exports.FileCleanupService = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
class FileCleanupService {
    constructor(uploadDir = 'uploads', maxAgeHours = 24) {
        this.cleanupInterval = null;
        this.uploadDir = uploadDir;
        this.maxAgeHours = maxAgeHours;
    }
    /**
     * Start the automatic cleanup service
     * Runs cleanup every hour by default
     */
    start(intervalMinutes = 60) {
        console.log(`[FileCleanup] Starting automatic file cleanup service`);
        console.log(`[FileCleanup] Files older than ${this.maxAgeHours} hours will be deleted`);
        console.log(`[FileCleanup] Cleanup runs every ${intervalMinutes} minutes`);
        // Run cleanup immediately on start
        this.cleanup().catch(error => {
            console.error('[FileCleanup] Initial cleanup failed:', error);
        });
        // Schedule periodic cleanup
        this.cleanupInterval = setInterval(() => {
            this.cleanup().catch(error => {
                console.error('[FileCleanup] Scheduled cleanup failed:', error);
            });
        }, intervalMinutes * 60 * 1000); // Convert minutes to milliseconds
    }
    /**
     * Stop the automatic cleanup service
     */
    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            console.log('[FileCleanup] Automatic file cleanup service stopped');
        }
    }
    /**
     * Perform cleanup of old files
     */
    async cleanup() {
        const deletedFiles = [];
        const errors = [];
        try {
            console.log(`[FileCleanup] Starting cleanup scan in: ${this.uploadDir}`);
            // Check if upload directory exists
            try {
                await promises_1.default.access(this.uploadDir);
            }
            catch {
                console.log(`[FileCleanup] Upload directory doesn't exist: ${this.uploadDir}`);
                return { deletedFiles, errors };
            }
            const files = await promises_1.default.readdir(this.uploadDir);
            const now = Date.now();
            const maxAgeMs = this.maxAgeHours * 60 * 60 * 1000;
            console.log(`[FileCleanup] Found ${files.length} files to check`);
            for (const file of files) {
                const filePath = path_1.default.join(this.uploadDir, file);
                try {
                    const stats = await promises_1.default.stat(filePath);
                    const fileAge = now - stats.mtime.getTime();
                    if (fileAge > maxAgeMs) {
                        await promises_1.default.unlink(filePath);
                        deletedFiles.push(file);
                        console.log(`[FileCleanup] Deleted old file: ${file} (age: ${Math.round(fileAge / (60 * 60 * 1000))}h)`);
                    }
                }
                catch (error) {
                    const errorMsg = `Failed to process file ${file}: ${error}`;
                    errors.push(errorMsg);
                    console.error(`[FileCleanup] ${errorMsg}`);
                }
            }
            console.log(`[FileCleanup] Cleanup completed. Deleted: ${deletedFiles.length}, Errors: ${errors.length}`);
        }
        catch (error) {
            const errorMsg = `Cleanup scan failed: ${error}`;
            errors.push(errorMsg);
            console.error(`[FileCleanup] ${errorMsg}`);
        }
        return { deletedFiles, errors };
    }
    /**
     * Get cleanup statistics
     */
    async getStats() {
        try {
            const files = await promises_1.default.readdir(this.uploadDir);
            const now = Date.now();
            const maxAgeMs = this.maxAgeHours * 60 * 60 * 1000;
            let totalFiles = 0;
            let oldFiles = 0;
            let totalSizeMB = 0;
            let oldSizeMB = 0;
            for (const file of files) {
                const filePath = path_1.default.join(this.uploadDir, file);
                try {
                    const stats = await promises_1.default.stat(filePath);
                    const fileAge = now - stats.mtime.getTime();
                    const fileSizeMB = stats.size / (1024 * 1024);
                    totalFiles++;
                    totalSizeMB += fileSizeMB;
                    if (fileAge > maxAgeMs) {
                        oldFiles++;
                        oldSizeMB += fileSizeMB;
                    }
                }
                catch (error) {
                    console.error(`[FileCleanup] Error getting stats for ${file}:`, error);
                }
            }
            return {
                totalFiles,
                oldFiles,
                totalSizeMB: Math.round(totalSizeMB * 100) / 100,
                oldSizeMB: Math.round(oldSizeMB * 100) / 100
            };
        }
        catch (error) {
            console.error('[FileCleanup] Error getting cleanup stats:', error);
            return { totalFiles: 0, oldFiles: 0, totalSizeMB: 0, oldSizeMB: 0 };
        }
    }
    /**
     * Manually trigger cleanup (useful for testing or admin endpoints)
     */
    async manualCleanup() {
        console.log('[FileCleanup] Manual cleanup triggered');
        return await this.cleanup();
    }
    /**
     * Update cleanup configuration
     */
    updateConfig(maxAgeHours, uploadDir) {
        if (maxAgeHours !== undefined) {
            this.maxAgeHours = maxAgeHours;
            console.log(`[FileCleanup] Updated max age to ${maxAgeHours} hours`);
        }
        if (uploadDir !== undefined) {
            this.uploadDir = uploadDir;
            console.log(`[FileCleanup] Updated upload directory to ${uploadDir}`);
        }
    }
}
exports.FileCleanupService = FileCleanupService;
// Export singleton instance
exports.fileCleanupService = new FileCleanupService();
