import { createClient, LiveTranscriptionEvents, LiveClient } from '@deepgram/sdk';
import { config } from '../config.js';

export interface TranscriptCallback {
  onTranscript: (transcript: string, isFinal: boolean, speechFinal: boolean) => void;
  onError: (error: Error) => void;
}

export class DeepgramSTT {
  private client: ReturnType<typeof createClient>;
  private connection: LiveClient | null = null;
  private callbacks: TranscriptCallback | null = null;
  private isConnected: boolean = false;

  constructor() {
    this.client = createClient(config.deepgram.apiKey);
  }

  async connect(callbacks: TranscriptCallback): Promise<void> {
    this.callbacks = callbacks;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Deepgram connection timeout'));
      }, 10000); // Increased timeout to 10s

      this.connection = this.client.listen.live({
        model: config.deepgram.model,
        language: config.deepgram.language,
        encoding: 'linear16',
        sample_rate: config.audio.plivoInboundSampleRate, // Plivo inbound is 8kHz
        punctuate: true,
        interim_results: true,
        endpointing: 300,
        utterance_end_ms: 1000,
      });

      this.connection.on(LiveTranscriptionEvents.Open, () => {
        console.log('[Deepgram] Connection opened');
        this.isConnected = true;
        clearTimeout(timeout);
        resolve();
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (transcript && transcript.trim()) {
          const isFinal = data.is_final || false;
          const speechFinal = data.speech_final || false;
          console.log(`[Deepgram] ${isFinal ? 'Final' : 'Interim'}${speechFinal ? ' (speech_final)' : ''}: ${transcript}`);
          this.callbacks?.onTranscript(transcript, isFinal, speechFinal);
        }
      });

      this.connection.on(LiveTranscriptionEvents.Error, (error) => {
        console.error('[Deepgram] Error:', error);
        clearTimeout(timeout);
        if (!this.isConnected) {
          reject(error);
        }
        this.callbacks?.onError(error);
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        console.log('[Deepgram] Connection closed');
        this.isConnected = false;
      });
    });
  }

  sendAudio(audioBuffer: Buffer): void {
    if (this.connection && this.isConnected) {
      const arrayBuffer = audioBuffer.buffer.slice(
        audioBuffer.byteOffset,
        audioBuffer.byteOffset + audioBuffer.byteLength
      );
      this.connection.send(arrayBuffer as ArrayBuffer);
    }
  }

  async close(): Promise<void> {
    if (this.connection) {
      this.connection.requestClose();
      this.connection = null;
      this.isConnected = false;
    }
  }
}
