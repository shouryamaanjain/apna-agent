import WebSocket from 'ws';
import { DeepgramSTT } from '../services/deepgram.js';
import { OpenAILLM } from '../services/openai.js';
import { HeyPixaTTS } from '../services/heypixa.js';
import { ElevenLabsTTS } from '../services/elevenlabs.js';
import { prepareAudioForPlivo, prepareElevenLabsAudioForPlivo, base64ToBuffer } from '../services/audio.js';
import { config } from '../config.js';
import type { PlivoInboundMessage, PlivoPlayAudioMessage, CallSession, CerebrasMessage } from '../types/index.js';

// Common TTS interface
interface TTSProvider {
  connect(callbacks: { onAudioChunk: (audio: Buffer) => void; onComplete: () => void; onError: (error: Error) => void }): Promise<void>;
  synthesize(text: string): void;
  close(): void;
}

export class CallHandler {
  private plivoWs: WebSocket;
  private deepgram: DeepgramSTT;
  private llm: OpenAILLM;
  private tts: TTSProvider | null = null;
  private ttsProvider: string;
  private session: CallSession;
  private transcriptBuffer: string = '';
  private silenceTimeout: NodeJS.Timeout | null = null;
  private isSpeaking: boolean = false;
  private lastAudioSentTime: number = 0; // Track when we last sent audio to detect echo
  private userSpeechEndTime: number = 0; // For latency tracking

  constructor(plivoWs: WebSocket) {
    this.plivoWs = plivoWs;
    this.deepgram = new DeepgramSTT();
    this.llm = new OpenAILLM();
    this.ttsProvider = config.tts.provider;
    console.log(`[CallHandler] Using TTS provider: ${this.ttsProvider}`);
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
      onTranscript: (transcript, isFinal, speechFinal) => this.handleTranscript(transcript, isFinal, speechFinal),
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
          // No greeting - wait for user to speak first
          break;

        case 'media':
          // Always send audio to Deepgram - smart interrupt logic handles filtering
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

  private handleTranscript(transcript: string, isFinal: boolean, speechFinal: boolean): void {
    console.log(`[CallHandler] Transcript: "${transcript}" (final: ${isFinal}, speechFinal: ${speechFinal}, isSpeaking: ${this.isSpeaking})`);

    // Check for echo even when not speaking (audio may still be playing through phone)
    const timeSinceAudio = Date.now() - this.lastAudioSentTime;
    const echoWindow = 4000; // 4 second window - accounts for audio playback + network delay

    if (timeSinceAudio < echoWindow) {
      console.log(`[CallHandler] Ignoring likely echo (${timeSinceAudio}ms since audio sent)`);
      return;
    }

    // Smart interrupt detection when agent is speaking
    if (this.isSpeaking) {
      // Only consider interrupting on speech_final (user finished speaking)
      if (speechFinal && this.shouldInterrupt(transcript)) {
        console.log('[CallHandler] Smart interrupt triggered');
        this.stopSpeaking();
        // Process this as user input
        this.transcriptBuffer = transcript;
        this.silenceTimeout = setTimeout(() => {
          this.respond(this.transcriptBuffer);
          this.transcriptBuffer = '';
        }, 300); // Shorter delay for interrupts
      }
      return;
    }

    this.transcriptBuffer = transcript;

    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }

    if (isFinal && transcript.trim()) {
      console.log('[CallHandler] Final transcript, will respond in 500ms');
      this.userSpeechEndTime = Date.now(); // Mark when user finished speaking
      this.silenceTimeout = setTimeout(() => {
        this.respond(this.transcriptBuffer);
        this.transcriptBuffer = '';
      }, 500);
    }
  }

  // Determine if transcript should trigger an interrupt (timing check already done in handleTranscript)
  private shouldInterrupt(transcript: string): boolean {
    const trimmed = transcript.trim();

    // Minimum length to avoid noise (at least 3 characters)
    if (trimmed.length < 3) {
      console.log('[CallHandler] Transcript too short for interrupt');
      return false;
    }

    console.log(`[CallHandler] Valid interrupt: "${trimmed}"`);
    return true;
  }

  private async respond(userMessage: string): Promise<void> {
    if (this.session.isProcessing || this.isSpeaking || !userMessage.trim()) return;

    console.log(`[User]: ${userMessage}`);
    this.session.isProcessing = true;

    const respondStartTime = Date.now();
    const sttLatency = respondStartTime - this.userSpeechEndTime;
    console.log(`[Latency] STT + silence delay: ${sttLatency}ms`);

    try {
      const response = await this.llm.generate(
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

      const ttsStartTime = Date.now();
      await this.speak(response, ttsStartTime);

      const totalLatency = Date.now() - this.userSpeechEndTime;
      console.log(`[Latency] TOTAL (user speech end -> TTS complete): ${totalLatency}ms`);
    } catch (error) {
      console.error('[CallHandler] Error:', error);
    } finally {
      this.session.isProcessing = false;
    }
  }

  private async speak(text: string, ttsStartTime?: number): Promise<void> {
    console.log(`[CallHandler] speak() called with: ${text}`);
    if (this.isSpeaking) {
      console.log('[CallHandler] Already speaking, skipping');
      return;
    }

    this.isSpeaking = true;
    let firstAudioReceived = false;
    const speakStartTime = ttsStartTime || Date.now();

    // Select audio converter based on TTS provider
    const convertAudio = this.ttsProvider === 'elevenlabs'
      ? prepareElevenLabsAudioForPlivo
      : prepareAudioForPlivo;

    return new Promise(async (resolve) => {
      try {
        // Create TTS instance based on provider
        if (!this.tts) {
          if (this.ttsProvider === 'elevenlabs') {
            console.log('[CallHandler] Creating new ElevenLabsTTS instance');
            this.tts = new ElevenLabsTTS();
          } else {
            console.log('[CallHandler] Creating new HeyPixaTTS instance');
            this.tts = new HeyPixaTTS();
          }
        }

        console.log(`[CallHandler] Connecting to ${this.ttsProvider}...`);
        await this.tts.connect({
          onAudioChunk: (audio) => {
            if (!firstAudioReceived) {
              firstAudioReceived = true;
              const ttfb = Date.now() - speakStartTime;
              console.log(`[Latency] TTS TTFB (${this.ttsProvider}): ${ttfb}ms`);
            }
            console.log(`[CallHandler] Received audio chunk: ${audio.length} bytes`);
            this.sendAudio(convertAudio(audio));
          },
          onComplete: () => {
            const ttsTotal = Date.now() - speakStartTime;
            console.log(`[Latency] TTS Total (${this.ttsProvider}): ${ttsTotal}ms`);
            console.log('[CallHandler] TTS complete, setting isSpeaking=false');
            this.isSpeaking = false;
          },
          onError: (error) => {
            console.error('[CallHandler] TTS onError:', error);
            this.isSpeaking = false;
          },
        });

        console.log(`[CallHandler] ${this.ttsProvider} connected, synthesizing...`);
        this.tts.synthesize(text);

        // Don't wait for completion - resolve immediately so we don't block
        // The callbacks will handle the audio streaming
        resolve();
      } catch (error) {
        console.error('[CallHandler] TTS error:', error);
        this.isSpeaking = false;
        this.tts?.close();
        this.tts = null;
        resolve();
      }
    });
  }

  private sendAudio(base64Audio: string): void {
    if (this.plivoWs.readyState !== WebSocket.OPEN) return;

    this.lastAudioSentTime = Date.now();

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
    console.log('[CallHandler] stopSpeaking() called');
    if (this.plivoWs.readyState === WebSocket.OPEN) {
      this.plivoWs.send(JSON.stringify({ event: 'clearAudio' }));
    }
    this.tts?.close();
    this.tts = null;
    this.isSpeaking = false;
    this.session.isProcessing = false;
  }

  async cleanup(): Promise<void> {
    if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
    await this.deepgram.close();
    this.tts?.close();
  }
}
