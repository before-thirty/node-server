// Add this to your Express server (routes/cron.ts or in your main server file)

import express from 'express';
import { refreshExpiredImageUrls } from './helpers/imageRefreshCron'; // Adjust path

const router = express.Router();

// Cron endpoint that App Engine will call
router.get('/refresh-images', async (req, res) => {
  try {
    // Security: Verify request is from App Engine Cron service
    const isCronRequest = req.get('X-Appengine-Cron') === 'true';
    const fromAppEngine = req.ip === '0.1.0.2' || req.ip === '0.1.0.1';
    
    if (!isCronRequest && !fromAppEngine) {
      return res.status(403).json({ error: 'Access forbidden: Not a cron request' });
    }

    console.log(`🕐 App Engine cron job triggered at ${new Date().toISOString()}`);
    
    // Run your image refresh function
    await refreshExpiredImageUrls();
    
    console.log('✅ App Engine cron job completed successfully');
    res.status(200).json({ 
      success: true, 
      message: 'Image refresh completed',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ App Engine cron job failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;

// In your main server file (app.ts):
// import cronRoutes from './routes/cron';
// app.use('/cron', cronRoutes);