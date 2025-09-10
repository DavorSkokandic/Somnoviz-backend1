# SomnoViz Deployment Guide

## Environment Configuration

### File Cleanup Settings
Configure these environment variables to customize file cleanup behavior:

```bash
# Maximum age of uploaded files in hours before deletion (default: 72 = 3 days)
FILE_MAX_AGE_HOURS=72

# How often to run cleanup in minutes (default: 60)
CLEANUP_INTERVAL_MINUTES=60

# Upload directory path (default: uploads)
UPLOAD_DIR=uploads

# Enable/disable automatic cleanup (default: true)
AUTO_CLEANUP_ENABLED=true

# Log cleanup operations (default: true)
LOG_CLEANUP=true

# Server port (default: 5000)
PORT=5000

# Environment (production/development)
NODE_ENV=production
```

## Development Setup

1. **Backend:**
   ```bash
   cd Somnoviz-backend
   npm install
   npm run dev
   ```

2. **Frontend:**
   ```bash
   cd Somnoviz/Somnoviz
   npm install
   npm run dev
   ```

## Production Deployment

### Backend
```bash
cd Somnoviz-backend
npm install
npm run build
npm start
```

### Frontend
```bash
cd Somnoviz/Somnoviz
npm install
npm run build
# Serve the dist/ folder with your web server
```

## Key Features

### Automatic File Cleanup
- Files are automatically deleted after 3 days (configurable)
- Cleanup runs every hour (configurable)
- Manual cleanup endpoint: `POST /api/cleanup/manual`
- Statistics endpoint: `GET /api/cleanup/stats`

### Relative API Calls
- All API calls use relative paths
- Works with any domain/port configuration
- No hardcoded URLs in the frontend
- Automatic proxy setup for development

### CORS Configuration
- Development: Allows localhost:5173 and localhost:3000
- Production: Configurable origin policy
- Supports credentials and common HTTP methods

## API Endpoints

### Upload
- `POST /api/upload` - Upload EDF file
- `GET /api/upload/edf-chunk` - Get EDF data chunk
- `GET /api/upload/edf-multi-chunk` - Get multi-channel data
- `GET /api/upload/edf-chunk-downsample` - Get downsampled data
- `POST /api/upload/max-min-values` - Get min/max values
- `POST /api/upload/ahi-analysis` - Perform AHI analysis

### Cleanup
- `GET /api/cleanup/stats` - Get cleanup statistics
- `POST /api/cleanup/manual` - Trigger manual cleanup

## Security Considerations

- Files are automatically cleaned up for privacy
- CORS is properly configured
- No sensitive data in URLs
- Environment-based configuration
- Proper error handling and logging
