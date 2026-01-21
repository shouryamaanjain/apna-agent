import WebSocket from 'ws';
import { DeepgramSTT } from '../services/deepgram.js';
import { CerebrasLLM } from '../services/cerebras.js';
import { HeyPixaTTS } from '../services/heypixa.js';
import { prepareAudioForPlivo, base64ToBuffer } from '../services/audio.js';
import type { PlivoInboundMessage, PlivoPlayAudioMessage, CallSession, CerebrasMessage } from '../types/index.js';

export class CallHandler {
  private plivoWs: WebSocket;
  private deepgram: DeepgramSTT;
  private cerebras: CerebrasLLM;
  private heypixa: HeyPixaTTS | null = null;
  private session: CallSession;
  private transcriptBuffer: string = '';
  private silenceTimeout: NodeJS.Timeout | null = null;
  private isSpeaking: boolean = false;

  constructor(plivoWs: WebSocket) {
    this.plivoWs = plivoWs;
    this.deepgram = new DeepgramSTT();
    this.cerebras = new CerebrasLLM();
    this.session = {
      callId: '',
      streamId: '',
      conversationHistory: [],
      isProcessing: false,
      currentTranscript: '',
    };
  }

  async initialize(): Promise<void> {
    console.log('[CallHandler] Initializing...');

    await this.deepgram.connect({
      onTranscript: (transcript, isFinal) => this.handleTranscript(transcript, isFinal),
      onError: (error) => console.error('[CallHandler] Deepgram error:', error),
    });

    console.log('[CallHandler] Ready');
  }

  handlePlivoMessage(data: WebSocket.Data, isBinary: boolean): void {
    try {
      if (isBinary) {
        this.deepgram.sendAudio(Buffer.from(data as Buffer));
        return;
      }

      const messageStr = data.toString();
      if (!messageStr?.trim()) return;

      const message = JSON.parse(messageStr) as PlivoInboundMessage;

      switch (message.event) {
        case 'start':
          this.session.streamId = message.start.streamId;
          this.session.callId = message.start.callId;
          console.log(`[CallHandler] Call started: ${this.session.callId}`);
          break;

        case 'media':
          if (message.media?.track === 'inbound' && message.media.payload) {
            this.deepgram.sendAudio(base64ToBuffer(message.media.payload));
          }
          break;

        case 'stop':
          console.log('[CallHandler] Call ended');
          this.cleanup();
          break;
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        try {
          this.deepgram.sendAudio(Buffer.from(data as Buffer));
        } catch {}
      }
    }
  }

  private handleTranscript(transcript: string, isFinal: boolean): void {
    // Interrupt if user speaks while agent is talking
    if (this.isSpeaking && transcript.trim()) {
      console.log('[CallHandler] Interrupted');
      this.stopSpeaking();
    }

    this.transcriptBuffer = transcript;

    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }

    if (isFinal && transcript.trim()) {
      this.silenceTimeout = setTimeout(() => {
        this.respond(this.transcriptBuffer);
        this.transcriptBuffer = '';
      }, 500);
    }
  }

  private async respond(userMessage: string): Promise<void> {
    if (this.session.isProcessing || this.isSpeaking || !userMessage.trim()) return;

    console.log(`[User]: ${userMessage}`);
    this.session.isProcessing = true;

    try {
      const response = await this.cerebras.generate(
        this.session.conversationHistory,
        userMessage
      );

      console.log(`[Agent]: ${response}`);

      this.session.conversationHistory.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: response }
      );

      // Keep last 20 messages
      if (this.session.conversationHistory.length > 20) {
        this.session.conversationHistory = this.session.conversationHistory.slice(-20);
      }

      await this.speak(response);
    } catch (error) {
      console.error('[CallHandler] Error:', error);
    } finally {
      this.session.isProcessing = false;
    }
  }

  private speak(text: string): Promise<void> {
    if (this.isSpeaking) return Promise.resolve();

    this.isSpeaking = true;

    return new Promise((resolve) => {
      if (this.heypixa) {
        this.heypixa.close();
        this.heypixa = null;
      }

      this.heypixa = new HeyPixaTTS();

      this.heypixa.connect({
        onAudioChunk: (audio) => {
          this.sendAudio(prepareAudioForPlivo(audio));
        },
        onComplete: () => {
          this.isSpeaking = false;
          this.heypixa?.close();
          this.heypixa = null;
          resolve();
        },
        onError: () => {
          this.isSpeaking = false;
          this.heypixa?.close();
          this.heypixa = null;
          resolve();
        },
      }).then(() => {
        this.heypixa?.synthesize(text);
      }).catch(() => {
        this.isSpeaking = false;
        resolve();
      });
    });
  }

  private sendAudio(base64Audio: string): void {
    if (this.plivoWs.readyState !== WebSocket.OPEN) return;

    this.plivoWs.send(JSON.stringify({
      event: 'playAudio',
      media: {
        contentType: 'audio/x-l16',
        sampleRate: 8000,
        payload: base64Audio,
      },
    }));
  }

  private stopSpeaking(): void {
    if (this.plivoWs.readyState === WebSocket.OPEN) {
      this.plivoWs.send(JSON.stringify({ event: 'clearAudio' }));
    }
    this.heypixa?.close();
    this.heypixa = null;
    this.isSpeaking = false;
    this.session.isProcessing = false;
  }

  async cleanup(): Promise<void> {
    if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
    await this.deepgram.close();
    this.heypixa?.close();
  }
}
