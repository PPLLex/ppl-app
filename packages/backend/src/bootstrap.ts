/**
 * Bootstrap entry point — sets up error handlers BEFORE any imports.
 * This ensures we always see crash logs even if imports fail.
 *
 * In compiled JS, TypeScript hoists `import` statements above all other code.
 * Using dynamic `require()` here ensures error handlers are registered FIRST.
 */

// These run BEFORE any require() calls
process.on('uncaughtException', (err: Error) => {
  console.error('[FATAL] Uncaught exception:', err.message);
  console.error(err.stack);
  // Use setTimeout to allow stderr to flush before exiting
  setTimeout(() => process.exit(1), 500);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  // Use setTimeout to allow stderr to flush before exiting
  setTimeout(() => process.exit(1), 500);
});

console.log('[Bootstrap] Error handlers registered, loading server...');

// Dynamic require — NOT import — so this runs AFTER error handlers
try {
  require('./server');
  console.log('[Bootstrap] Server module loaded successfully');
} catch (err: any) {
  console.error('[Bootstrap] CRASHED during server load:', err.message);
  console.error(err.stack);
  // Allow stderr to flush
  setTimeout(() => process.exit(1), 500);
}
