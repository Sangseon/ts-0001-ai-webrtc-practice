import { createSfu } from './sfu.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--once') || args.length > 1) {
    throw new Error('Usage: sfu-check [--once]');
  }

  let requestStop!: () => void;
  const stopped = new Promise<void>(resolve => { requestStop = resolve; });
  const onSignal = (signal: NodeJS.Signals) => {
    console.log(`SFU shutdown requested signal=${signal}`);
    requestStop();
  };

  // Register before startup so a signal during worker/Router creation is retained.
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  let sfu: Awaited<ReturnType<typeof createSfu>> | undefined;

  try {
    sfu = await createSfu();
    sfu.worker.once('died', () => {
      process.exitCode = 1;
      requestStop();
    });

    if (sfu.worker.closed || sfu.router.closed) {
      throw new Error('SFU closed during startup');
    }

    console.log('SFU ready (worker + Router only; no media transports)');

    if (!args.includes('--once')) {
      console.log('Press Ctrl+C to close the Router and worker.');
      await stopped;
    }
  } finally {
    try {
      await sfu?.close();
    } finally {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    }
  }
}

main().catch((error: unknown) => {
  console.error('SFU check failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
