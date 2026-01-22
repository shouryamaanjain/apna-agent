/**
 * Audio processing utilities
 * High-quality resampling using Lanczos filter
 * Output: 16kHz PCM16 for Plivo
 */

/**
 * Lanczos kernel function
 * The Lanczos kernel is a windowed sinc function that provides excellent
 * frequency response and minimal ringing artifacts
 *
 * @param x - Input value
 * @param a - Lanczos parameter (window size), typically 3 for audio
 */
function lanczosKernel(x: number, a: number): number {
  if (x === 0) return 1;
  if (Math.abs(x) >= a) return 0;

  const piX = Math.PI * x;
  const piXOverA = piX / a;

  // sinc(x) * sinc(x/a)
  return (Math.sin(piX) / piX) * (Math.sin(piXOverA) / piXOverA);
}

/**
 * High-quality resampling using Lanczos interpolation
 *
 * Lanczos resampling works by:
 * 1. For each output sample, calculate its position in the input
 * 2. Use a windowed sinc function (Lanczos kernel) to weight nearby input samples
 * 3. Sum the weighted samples to get the output value
 *
 * This effectively applies a near-ideal low-pass filter while resampling,
 * preventing aliasing artifacts that occur with simpler methods.
 *
 * @param inputBuffer - PCM16 audio buffer
 * @param sourceRate - Source sample rate (e.g., 32000)
 * @param targetRate - Target sample rate (e.g., 16000)
 * @param lanczosA - Lanczos window size (default 3, higher = better quality but slower)
 */
export function resampleLanczos(
  inputBuffer: Buffer,
  sourceRate: number,
  targetRate: number,
  lanczosA: number = 3
): Buffer {
  if (sourceRate === targetRate) {
    return inputBuffer;
  }

  const ratio = sourceRate / targetRate;
  const inputSamples = inputBuffer.length / 2; // 16-bit = 2 bytes per sample
  const outputSamples = Math.floor(inputSamples / ratio);
  const outputBuffer = Buffer.alloc(outputSamples * 2);

  // Pre-compute input samples as float array for faster access
  const inputFloat = new Float64Array(inputSamples);
  for (let i = 0; i < inputSamples; i++) {
    inputFloat[i] = inputBuffer.readInt16LE(i * 2);
  }

  for (let i = 0; i < outputSamples; i++) {
    const srcCenter = i * ratio;
    const srcStart = Math.floor(srcCenter) - lanczosA + 1;
    const srcEnd = Math.floor(srcCenter) + lanczosA;

    let sum = 0;
    let weightSum = 0;

    for (let j = srcStart; j <= srcEnd; j++) {
      if (j >= 0 && j < inputSamples) {
        const distance = srcCenter - j;
        const weight = lanczosKernel(distance, lanczosA);
        sum += inputFloat[j] * weight;
        weightSum += weight;
      }
    }

    // Normalize by weight sum to handle edge cases
    const interpolated = weightSum > 0 ? sum / weightSum : 0;

    // Clamp to 16-bit range
    const clamped = Math.max(-32768, Math.min(32767, Math.round(interpolated)));

    outputBuffer.writeInt16LE(clamped, i * 2);
  }

  return outputBuffer;
}

/**
 * Legacy linear interpolation resampling (kept for reference)
 * Simple but produces aliasing artifacts
 */
export function resamplePCM16Linear(
  inputBuffer: Buffer,
  sourceRate: number,
  targetRate: number
): Buffer {
  if (sourceRate === targetRate) {
    return inputBuffer;
  }

  const ratio = sourceRate / targetRate;
  const inputSamples = inputBuffer.length / 2;
  const outputSamples = Math.floor(inputSamples / ratio);
  const outputBuffer = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1);
    const fraction = srcIndex - srcIndexFloor;

    const sample1 = inputBuffer.readInt16LE(srcIndexFloor * 2);
    const sample2 = inputBuffer.readInt16LE(srcIndexCeil * 2);

    const interpolated = Math.round(sample1 + (sample2 - sample1) * fraction);
    const clamped = Math.max(-32768, Math.min(32767, interpolated));

    outputBuffer.writeInt16LE(clamped, i * 2);
  }

  return outputBuffer;
}

/**
 * Convert Buffer to base64 string
 */
export function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64');
}

/**
 * Convert base64 string to Buffer
 */
export function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

/**
 * Prepare HeyPixa audio (32kHz) for Plivo (16kHz)
 * Uses high-quality Lanczos resampling (2:1 downsampling)
 */
export function prepareAudioForPlivo(heypixaAudio: Buffer): string {
  // High-quality Lanczos resampling from 32kHz to 16kHz
  const resampled = resampleLanczos(heypixaAudio, 32000, 16000, 3);

  // Add 100ms of silence padding (16000 samples/sec * 0.1 sec * 2 bytes = 3200 bytes)
  const silencePadding = Buffer.alloc(3200, 0);
  const paddedAudio = Buffer.concat([resampled, silencePadding]);

  return bufferToBase64(paddedAudio);
}

/**
 * Prepare ElevenLabs audio (16kHz) for Plivo (16kHz)
 * No resampling needed - already at target sample rate
 */
export function prepareElevenLabsAudioForPlivo(elevenLabsAudio: Buffer): string {
  // No resampling needed - ElevenLabs already outputs 16kHz

  // Add 100ms of silence padding (16000 samples/sec * 0.1 sec * 2 bytes = 3200 bytes)
  const silencePadding = Buffer.alloc(3200, 0);
  const paddedAudio = Buffer.concat([elevenLabsAudio, silencePadding]);

  return bufferToBase64(paddedAudio);
}
