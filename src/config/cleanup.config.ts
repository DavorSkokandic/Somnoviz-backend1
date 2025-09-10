export const cleanupConfig = {
  // Maximum age of files in hours before they get deleted (default: 72 hours = 3 days)
  maxAgeHours: process.env.FILE_MAX_AGE_HOURS ? parseInt(process.env.FILE_MAX_AGE_HOURS) : 72,
  
  // How often to run cleanup in minutes
  intervalMinutes: process.env.CLEANUP_INTERVAL_MINUTES ? parseInt(process.env.CLEANUP_INTERVAL_MINUTES) : 60,
  
  // Upload directory path
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  
  // Enable/disable automatic cleanup
  enabled: process.env.AUTO_CLEANUP_ENABLED !== 'false', // defaults to true unless explicitly disabled
  
  // Log cleanup operations
  logOperations: process.env.LOG_CLEANUP !== 'false' // defaults to true unless explicitly disabled
};

export default cleanupConfig;

