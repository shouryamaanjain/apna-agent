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
  private isConfigured: boolean = false;
  private isConnected: boolean = false;

  async connect(callbacks: TTSCallbacks): Promise<void> {
    this.callbacks = callbacks;

    // Reuse existing connection if available
    if (this.ws && this.isConnected && this.isConfigured) {
      return;
    }

    const endpoint = getActiveHeyPixaEndpoint();

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(endpoint);

      const timeout = setTimeout(() => {
        reject(new Error('HeyPixa connection timeout'));
      }, 10000);

      this.ws.on('open', () => {
        this.isConnected = true;

        // Send config and wait for confirmation
        const configMsg: HeyPixaConfigMessage = {
          type: 'config',
          voice: config.heypixa.voice,
          top_p: 0.95,
          repetition_penalty: 1.3,
        };
        this.ws!.send(JSON.stringify(configMsg));
      });

      this.ws.on('message', (data: WebSocket.Data, isBinary: boolean) => {
        if (isBinary) {
          const audioBuffer = Buffer.from(data as Buffer);
          this.callbacks?.onAudioChunk(audioBuffer);
        } else {
          try {
            const message = JSON.parse(data.toString()) as HeyPixaStatusMessage;

            if (message.status === 'config_updated') {
              this.isConfigured = true;
              clearTimeout(timeout);
              resolve();
            } else if (message.status === 'done') {
              this.callbacks?.onComplete();
            } else if (message.status === 'error') {
              this.callbacks?.onError(new Error(message.message || 'HeyPixa error'));
            }
          } catch {}
        }
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        this.isConnected = false;
        this.isConfigured = false;
        this.callbacks?.onError(error);
        reject(error);
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        this.isConfigured = false;
      });
    });
  }

  synthesize(text: string): void {
    if (!this.ws || !this.isConnected || !this.isConfigured) {
      throw new Error('HeyPixa not ready');
    }

    const textMsg: HeyPixaTextMessage = {
      type: 'text',
      content: text,
      is_final: true,
    };
    this.ws.send(JSON.stringify(textMsg));
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isConfigured = false;
  }
}
