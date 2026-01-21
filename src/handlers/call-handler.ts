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
  private currentAgentText: string = ''; // Track what agent is saying for smart interrupts
  private lastAudioSentTime: number = 0; // Track when we last sent audio to detect echo

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
          // Send greeting to test TTS pipeline
          this.speak('नमस्ते, मैं आपकी कैसे मदद कर सकती हूं?');
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
      this.silenceTimeout = setTimeout(() => {
        this.respond(this.transcriptBuffer);
        this.transcriptBuffer = '';
      }, 500);
    }
  }

  // Determine if transcript should trigger an interrupt
  private shouldInterrupt(transcript: string): boolean {
    const trimmed = transcript.trim().toLowerCase();

    // Minimum length to avoid noise (at least 3 characters)
    if (trimmed.length < 3) {
      console.log('[CallHandler] Transcript too short for interrupt');
      return false;
    }

    // Timing-based echo detection: if audio was sent recently, this is likely echo
    // Audio takes ~500-2000ms to play through phone + get transcribed back
    const timeSinceAudio = Date.now() - this.lastAudioSentTime;
    const echoWindow = 3000; // 3 second window after sending audio

    if (timeSinceAudio < echoWindow) {
      console.log(`[CallHandler] Likely echo (${timeSinceAudio}ms since audio sent), ignoring`);
      return false;
    }

    // Also check text similarity as backup
    const agentText = this.currentAgentText.toLowerCase();
    if (agentText && this.isSimilar(trimmed, agentText)) {
      console.log('[CallHandler] Transcript matches agent speech (echo), ignoring');
      return false;
    }

    console.log(`[CallHandler] Valid interrupt: "${trimmed}" (${timeSinceAudio}ms since audio)`);
    return true;
  }

  // Simple similarity check - if transcript is contained in agent text, it's likely echo
  private isSimilar(transcript: string, agentText: string): boolean {
    // If transcript is a substring of agent text, likely echo
    if (agentText.includes(transcript)) return true;

    // If first few words match, likely echo
    const transcriptWords = transcript.split(/\s+/).slice(0, 3).join(' ');
    if (transcriptWords.length > 3 && agentText.includes(transcriptWords)) return true;

    return false;
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

  private async speak(text: string): Promise<void> {
    console.log(`[CallHandler] speak() called with: ${text}`);
    if (this.isSpeaking) {
      console.log('[CallHandler] Already speaking, skipping');
      return;
    }

    this.isSpeaking = true;
    this.currentAgentText = text; // Track for echo detection

    return new Promise(async (resolve) => {
      try {
        // Reuse existing connection or create new one
        if (!this.heypixa) {
          console.log('[CallHandler] Creating new HeyPixaTTS instance');
          this.heypixa = new HeyPixaTTS();
        }

        console.log('[CallHandler] Connecting to HeyPixa...');
        await this.heypixa.connect({
          onAudioChunk: (audio) => {
            console.log(`[CallHandler] Received audio chunk: ${audio.length} bytes`);
            this.sendAudio(prepareAudioForPlivo(audio));
          },
          onComplete: () => {
            console.log('[CallHandler] TTS complete, setting isSpeaking=false');
            this.isSpeaking = false;
            this.currentAgentText = '';
          },
          onError: (error) => {
            console.error('[CallHandler] TTS onError:', error);
            this.isSpeaking = false;
            this.currentAgentText = '';
          },
        });

        console.log('[CallHandler] HeyPixa connected, synthesizing...');
        this.heypixa.synthesize(text);

        // Don't wait for completion - resolve immediately so we don't block
        // The callbacks will handle the audio streaming
        resolve();
      } catch (error) {
        console.error('[CallHandler] TTS error:', error);
        this.isSpeaking = false;
        this.heypixa?.close();
        this.heypixa = null;
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
    this.heypixa?.close();
    this.heypixa = null;
    this.isSpeaking = false;
    this.currentAgentText = '';
    this.session.isProcessing = false;
  }

  async cleanup(): Promise<void> {
    if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
    await this.deepgram.close();
    this.heypixa?.close();
  }
}
