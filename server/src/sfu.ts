import { once } from 'node:events';
import { createWorker } from 'mediasoup';
import type { RouterRtpCodecCapability, Worker } from 'mediasoup/types';

export const mediaCodecs: RouterRtpCodecCapability[] = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
];

async function closeWorker(worker: Worker) {
  const closed = worker.subprocessClosed
    ? Promise.resolve()
    : once(worker, 'subprocessclose', { signal: AbortSignal.timeout(5000) });

  worker.close();

  try {
    await closed;
  } catch (error) {
    // Only terminate the child owned by this Worker if graceful closure times out.
    if (!worker.subprocessClosed) {
      process.kill(worker.pid, 'SIGKILL');
    }
    throw error;
  }

  console.log(`SFU worker closed pid=${worker.pid} subprocessClosed=${worker.subprocessClosed}`);
}

export async function createSfu(codecs = mediaCodecs) {
  const worker = await createWorker({ logLevel: 'warn' });
  console.log(`SFU worker created pid=${worker.pid}`);

  worker.once('died', (error) => {
    console.error(`SFU worker died pid=${worker.pid}: ${error.message}`);
  });

  try {
    const router = await worker.createRouter({ mediaCodecs: codecs });
    console.log(`SFU router created id=${router.id} codecs=${router.rtpCapabilities.codecs?.map(codec => codec.mimeType).join(',')}`);

    let closing: Promise<void> | undefined;

    function close() {
      closing ??= (async () => {
        router.close();
        console.log(`SFU router closed id=${router.id} closed=${router.closed}`);
        await closeWorker(worker);
      })();
      return closing;
    }

    return { worker, router, close };
  } catch (error) {
    await closeWorker(worker);
    throw error;
  }
}
