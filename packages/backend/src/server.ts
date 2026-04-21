// Register global error handlers FIRST (before imports can throw)
process.on('uncaughtException', (err: Error) => {
  console.error('[FATAL] Uncaught exception:', err.message);
  console.error(err.stack);
  setTimeout(() => process.exit(1), 500);
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  setTimeout(() => process.exit(1), 500);
});

import app from './app';
import { config, validateProductionConfig } from './config';
import { startCronJobs, stopCronJobs } from './services/cronService';

console.log('[Server] Modules imported successfully');

const start = async () => {
  try {
    console.log('[Server] Validating config...');
    // Ensure all required secrets exist in production
    validateProductionConfig();

    console.log('[Server] Starting listener on port', config.port);
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
    // Use setTimeout to allow stderr to flush
    setTimeout(() => process.exit(1), 500);
  }
};

start();
