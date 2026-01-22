import WebSocket from 'ws';
import { config } from '../config.js';

export interface TTSCallbacks {
  onAudioChunk: (audioBuffer: Buffer) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

export class ElevenLabsTTS {
  private ws: WebSocket | null = null;
  private callbacks: TTSCallbacks | null = null;
  private isConnected: boolean = false;

  async connect(callbacks: TTSCallbacks): Promise<void> {
    this.callbacks = callbacks;

    // Reuse existing connection if available
    if (this.ws && this.isConnected) {
      console.log('[ElevenLabs] Reusing existing connection');
      return;
    }

    const voiceId = config.elevenlabs.voiceId;
    const modelId = config.elevenlabs.modelId;
    // Use pcm_16000 - will resample to 8kHz for Plivo
    const endpoint = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${modelId}&output_format=pcm_16000`;

    console.log(`[ElevenLabs] Connecting to: ${endpoint}`);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(endpoint, {
        headers: {
          'xi-api-key': config.elevenlabs.apiKey,
        },
      });

      const timeout = setTimeout(() => {
        console.error('[ElevenLabs] Connection timeout');
        reject(new Error('ElevenLabs connection timeout'));
      }, 10000);

      this.ws.on('open', () => {
        console.log('[ElevenLabs] WebSocket opened');
        this.isConnected = true;

        // Send BOS (beginning of stream) message with voice settings
        const bosMessage = {
          text: ' ',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0,
            use_speaker_boost: true,
          },
          generation_config: {
            chunk_length_schedule: [50], // Lower for faster first chunk
          },
        };
        console.log('[ElevenLabs] Sending BOS message');
        this.ws!.send(JSON.stringify(bosMessage));
        clearTimeout(timeout);
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.audio) {
            // Decode base64 audio
            const audioBuffer = Buffer.from(message.audio, 'base64');
            console.log(`[ElevenLabs] Received audio chunk: ${audioBuffer.length} bytes`);
            this.callbacks?.onAudioChunk(audioBuffer);
          }

          if (message.isFinal) {
            console.log('[ElevenLabs] Synthesis done');
            this.callbacks?.onComplete();
          }

          if (message.error) {
            console.error('[ElevenLabs] Error:', message.error);
            this.callbacks?.onError(new Error(message.error));
          }
        } catch (e) {
          console.error('[ElevenLabs] Failed to parse message:', e);
        }
      });

      this.ws.on('error', (error) => {
        console.error('[ElevenLabs] WebSocket error:', error);
        clearTimeout(timeout);
        this.isConnected = false;
        this.callbacks?.onError(error);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[ElevenLabs] WebSocket closed: code=${code}, reason=${reason?.toString()}`);
        this.isConnected = false;
      });
    });
  }

  synthesize(text: string): void {
    if (!this.ws || !this.isConnected) {
      throw new Error('ElevenLabs not ready');
    }

    console.log(`[ElevenLabs] Synthesizing: ${text}`);

    // Send text with flush to trigger immediate generation
    const textMessage = {
      text: text + ' ',
      flush: true,
    };
    this.ws.send(JSON.stringify(textMessage));

    // Send EOS (end of stream) to signal completion
    const eosMessage = {
      text: '',
    };
    this.ws.send(JSON.stringify(eosMessage));
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
