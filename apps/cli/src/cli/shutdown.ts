type ShutdownCallback = () => Promise<void>;

let shutdownCallbacks: ShutdownCallback[] = [];
let isShuttingDown = false;

/**
 * Register a callback to be called on shutdown (SIGINT/SIGTERM).
 * Multiple callbacks are called in LIFO order (last registered = first called).
 * The process exits after all callbacks complete.
 *
 * @param callback - Async function to run during shutdown
 */
export function setupShutdownHandler(callback: ShutdownCallback): void {
  shutdownCallbacks.push(callback);

  // Only register signal handlers once
  if (shutdownCallbacks.length === 1) {
    const handler = async () => {
      if (isShuttingDown) return; // Prevent double-shutdown
      isShuttingDown = true;

      // Execute callbacks in LIFO order
      const callbacks = [...shutdownCallbacks].reverse();
      for (const cb of callbacks) {
        try {
          await cb();
        } catch (err) {
          console.error('Shutdown error:', (err as Error).message);
        }
      }

      process.exit(0);
    };

    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  }
}
