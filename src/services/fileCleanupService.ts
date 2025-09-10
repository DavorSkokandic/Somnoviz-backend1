import fs from 'fs/promises';
import path from 'path';

export class FileCleanupService {
  private uploadDir: string;
  private maxAgeHours: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(uploadDir: string = 'uploads', maxAgeHours: number = 24) {
    this.uploadDir = uploadDir;
    this.maxAgeHours = maxAgeHours;
  }

  /**
   * Start the automatic cleanup service
   * Runs cleanup every hour by default
   */
  start(intervalMinutes: number = 60): void {
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
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[FileCleanup] Automatic file cleanup service stopped');
    }
  }

  /**
   * Perform cleanup of old files
   */
  async cleanup(): Promise<{ deletedFiles: string[], errors: string[] }> {
    const deletedFiles: string[] = [];
    const errors: string[] = [];
    
    try {
      console.log(`[FileCleanup] Starting cleanup scan in: ${this.uploadDir}`);
      
      // Check if upload directory exists
      try {
        await fs.access(this.uploadDir);
      } catch {
        console.log(`[FileCleanup] Upload directory doesn't exist: ${this.uploadDir}`);
        return { deletedFiles, errors };
      }

      const files = await fs.readdir(this.uploadDir);
      const now = Date.now();
      const maxAgeMs = this.maxAgeHours * 60 * 60 * 1000;

      console.log(`[FileCleanup] Found ${files.length} files to check`);

      for (const file of files) {
        const filePath = path.join(this.uploadDir, file);
        
        try {
          const stats = await fs.stat(filePath);
          const fileAge = now - stats.mtime.getTime();
          
          if (fileAge > maxAgeMs) {
            await fs.unlink(filePath);
            deletedFiles.push(file);
            console.log(`[FileCleanup] Deleted old file: ${file} (age: ${Math.round(fileAge / (60 * 60 * 1000))}h)`);
          }
        } catch (error) {
          const errorMsg = `Failed to process file ${file}: ${error}`;
          errors.push(errorMsg);
          console.error(`[FileCleanup] ${errorMsg}`);
        }
      }

      console.log(`[FileCleanup] Cleanup completed. Deleted: ${deletedFiles.length}, Errors: ${errors.length}`);
      
    } catch (error) {
      const errorMsg = `Cleanup scan failed: ${error}`;
      errors.push(errorMsg);
      console.error(`[FileCleanup] ${errorMsg}`);
    }

    return { deletedFiles, errors };
  }

  /**
   * Get cleanup statistics
   */
  async getStats(): Promise<{
    totalFiles: number;
    oldFiles: number;
    totalSizeMB: number;
    oldSizeMB: number;
  }> {
    try {
      const files = await fs.readdir(this.uploadDir);
      const now = Date.now();
      const maxAgeMs = this.maxAgeHours * 60 * 60 * 1000;
      
      let totalFiles = 0;
      let oldFiles = 0;
      let totalSizeMB = 0;
      let oldSizeMB = 0;

      for (const file of files) {
        const filePath = path.join(this.uploadDir, file);
        try {
          const stats = await fs.stat(filePath);
          const fileAge = now - stats.mtime.getTime();
          const fileSizeMB = stats.size / (1024 * 1024);
          
          totalFiles++;
          totalSizeMB += fileSizeMB;
          
          if (fileAge > maxAgeMs) {
            oldFiles++;
            oldSizeMB += fileSizeMB;
          }
        } catch (error) {
          console.error(`[FileCleanup] Error getting stats for ${file}:`, error);
        }
      }

      return {
        totalFiles,
        oldFiles,
        totalSizeMB: Math.round(totalSizeMB * 100) / 100,
        oldSizeMB: Math.round(oldSizeMB * 100) / 100
      };
    } catch (error) {
      console.error('[FileCleanup] Error getting cleanup stats:', error);
      return { totalFiles: 0, oldFiles: 0, totalSizeMB: 0, oldSizeMB: 0 };
    }
  }

  /**
   * Manually trigger cleanup (useful for testing or admin endpoints)
   */
  async manualCleanup(): Promise<{ deletedFiles: string[], errors: string[] }> {
    console.log('[FileCleanup] Manual cleanup triggered');
    return await this.cleanup();
  }

  /**
   * Update cleanup configuration
   */
  updateConfig(maxAgeHours?: number): void {
    if (maxAgeHours !== undefined) {
      this.maxAgeHours = maxAgeHours;
      console.log(`[FileCleanup] Updated max age to ${maxAgeHours} hours`);
    }
  }
}

// Export singleton instance
export const fileCleanupService = new FileCleanupService();
