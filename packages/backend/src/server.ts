import app from './app';
import { config, validateProductionConfig } from './config';
import { startCronJobs, stopCronJobs } from './services/cronService';

const start = async () => {
  try {
    // Ensure all required secrets exist in production
    validateProductionConfig();
    const server = app.listen(config.port, () => {
      console.log(`
  ╔══════════════════════════════════════════╗
  ║   PPL App Backend                        ║
  ║   Running on port ${config.port}                   ║
  ║   Environment: ${config.nodeEnv.padEnd(24)}║
  ╚══════════════════════════════════════════╝
      `);

      // Start background jobs
      startCronJobs();
    });

    // Graceful shutdown
    const shutdown = () => {
      console.log('\nShutting down gracefully...');
      stopCronJobs();
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

start();
