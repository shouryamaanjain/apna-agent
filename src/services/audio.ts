/**
 * Audio processing utilities
 * Handles resampling from HeyPixa's 32kHz to Plivo's 8kHz
 */

/**
 * Downsample PCM16 audio from source rate to target rate
 * Uses linear interpolation for simplicity
 */
export function resamplePCM16(
  inputBuffer: Buffer,
  sourceRate: number,
  targetRate: number
): Buffer {
  if (sourceRate === targetRate) {
    return inputBuffer;
  }

  const ratio = sourceRate / targetRate;
  const inputSamples = inputBuffer.length / 2; // 16-bit = 2 bytes per sample
  const outputSamples = Math.floor(inputSamples / ratio);
  const outputBuffer = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1);
    const fraction = srcIndex - srcIndexFloor;

    // Read samples (little-endian signed 16-bit)
    const sample1 = inputBuffer.readInt16LE(srcIndexFloor * 2);
    const sample2 = inputBuffer.readInt16LE(srcIndexCeil * 2);

    // Linear interpolation
    const interpolated = Math.round(sample1 + (sample2 - sample1) * fraction);

    // Clamp to 16-bit range
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
 * Downsample HeyPixa audio (32kHz) to Plivo format (8kHz) and encode as base64
 * Adds small silence padding at end to prevent cutoff
 */
export function prepareAudioForPlivo(heypixaAudio: Buffer): string {
  const resampled = resamplePCM16(heypixaAudio, 32000, 8000);

  // Add 100ms of silence at the end to prevent cutoff (8000 samples/sec * 0.1 sec * 2 bytes)
  const silencePadding = Buffer.alloc(1600, 0);
  const paddedAudio = Buffer.concat([resampled, silencePadding]);

  return bufferToBase64(paddedAudio);
}

/**
 * Downsample ElevenLabs audio (16kHz) to Plivo format (8kHz) and encode as base64
 * Adds small silence padding at end to prevent cutoff
 */
export function prepareElevenLabsAudioForPlivo(elevenLabsAudio: Buffer): string {
  const resampled = resamplePCM16(elevenLabsAudio, 16000, 8000);

  // Add 100ms of silence at the end to prevent cutoff
  const silencePadding = Buffer.alloc(1600, 0);
  const paddedAudio = Buffer.concat([resampled, silencePadding]);

  return bufferToBase64(paddedAudio);
}
