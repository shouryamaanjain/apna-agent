import WebSocket from 'ws';
import { config, getActiveHeyPixaEndpoint } from '../config.js';
import type { HeyPixaConfigMessage, HeyPixaTextMessage, HeyPixaStatusMessage } from '../types/index.js';

export interface TTSCallbacks {
  onAudioChunk: (audioBuffer: Buffer) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

export class HeyPixaTTS {
  private ws: WebSocket | null = null;
  private callbacks: TTSCallbacks | null = null;
  private audioChunks: Buffer[] = [];

  async connect(callbacks: TTSCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.audioChunks = [];

    const endpoint = getActiveHeyPixaEndpoint();
    console.log(`[HeyPixa] Connecting to checkpoint: ${config.heypixa.activeCheckpoint} at ${endpoint}`);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(endpoint);

      const timeout = setTimeout(() => {
        reject(new Error('HeyPixa WebSocket connection timeout'));
      }, 5000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        console.log('[HeyPixa] WebSocket connected');

        // Send initial config
        const configMsg: HeyPixaConfigMessage = {
          type: 'config',
          voice: config.heypixa.voice,
          top_p: 0.95,
          repetition_penalty: 1.3,
        };
        this.ws!.send(JSON.stringify(configMsg));
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data, isBinary: boolean) => {
        if (isBinary) {
          // Binary frame = raw PCM16 audio
          const audioBuffer = Buffer.from(data as Buffer);
          this.audioChunks.push(audioBuffer);
          this.callbacks?.onAudioChunk(audioBuffer);
        } else {
          // Text frame = JSON status message
          try {
            const message = JSON.parse(data.toString()) as HeyPixaStatusMessage;
            console.log(`[HeyPixa] Status: ${message.status}`);

            if (message.status === 'done') {
              this.callbacks?.onComplete();
            } else if (message.status === 'error') {
              this.callbacks?.onError(new Error(message.message || 'HeyPixa synthesis error'));
            }
          } catch {
            console.warn('[HeyPixa] Failed to parse text message:', data.toString());
          }
        }
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        console.error('[HeyPixa] WebSocket error:', error);
        this.callbacks?.onError(error);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('[HeyPixa] WebSocket closed');
      });
    });
  }

  synthesize(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('HeyPixa WebSocket not connected');
    }

    console.log(`[HeyPixa] Synthesizing: ${text}`);

    const textMsg: HeyPixaTextMessage = {
      type: 'text',
      content: text,
      is_final: true,
    };
    this.ws.send(JSON.stringify(textMsg));
  }

  // Stream text in chunks (for lower latency with streaming LLM)
  sendTextChunk(text: string, isFinal: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('HeyPixa WebSocket not connected');
    }

    const textMsg: HeyPixaTextMessage = {
      type: 'text',
      content: text,
      is_final: isFinal,
    };
    this.ws.send(JSON.stringify(textMsg));
  }

  getAllAudio(): Buffer {
    return Buffer.concat(this.audioChunks);
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.audioChunks = [];
  }
}
