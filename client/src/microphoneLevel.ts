// RMS of normalized time-domain PCM. Invalid samples are not a usable signal.
export function microphoneRms(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (value === undefined || !Number.isFinite(value)) return 0;
    const limited = Math.max(-1, Math.min(1, value));
    sum += limited * limited;
  }
  return Math.sqrt(sum / samples.length);
}

// Display scale only: RMS 0.5 reaches 100. This is not calibrated dB SPL.
export function microphoneLevel(rms: number): number {
  return Number.isFinite(rms) ? Math.max(0, Math.min(100, Math.round(rms * 200))) : 0;
}
