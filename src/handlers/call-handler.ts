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
  private isGenerating: boolean = false;

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
    console.log('[CallHandler] Initializing services...');

    // Connect to Deepgram STT
    await this.deepgram.connect({
      onTranscript: (transcript, isFinal) => this.handleTranscript(transcript, isFinal),
      onError: (error) => console.error('[CallHandler] Deepgram error:', error),
    });

    console.log('[CallHandler] Services initialized');
  }

  handlePlivoMessage(data: WebSocket.Data, isBinary: boolean): void {
    try {
      // Handle binary audio data directly
      if (isBinary) {
        const audioBuffer = Buffer.from(data as Buffer);
        this.deepgram.sendAudio(audioBuffer);
        return;
      }

      // Handle JSON text messages
      const messageStr = data.toString();

      // Skip empty messages
      if (!messageStr || messageStr.trim() === '') {
        return;
      }

      const message = JSON.parse(messageStr) as PlivoInboundMessage;

      switch (message.event) {
        case 'start':
          this.session.streamId = message.start.streamId;
          this.session.callId = message.start.callId;
          console.log(`[CallHandler] Stream started - CallID: ${this.session.callId}`);

          // Send initial greeting
          this.speakToUser('नमस्ते! मैं पिक्सा हूं। मैं आपकी कैसे मदद कर सकती हूं?');
          break;

        case 'media':
          // Plivo sends audio in 'payload' field, 'chunk' is sequence number
          if (message.media && message.media.track === 'inbound' && message.media.payload) {
            const audioBuffer = base64ToBuffer(message.media.payload);
            this.deepgram.sendAudio(audioBuffer);
          }
          break;

        case 'stop':
          console.log('[CallHandler] Stream stopped');
          this.cleanup();
          break;
      }
    } catch (error) {
      // Only log if it's not a JSON parse error for binary data
      if (error instanceof SyntaxError) {
        // Likely binary data that slipped through, try to handle as audio
        try {
          const audioBuffer = Buffer.from(data as Buffer);
          if (audioBuffer.length > 0) {
            this.deepgram.sendAudio(audioBuffer);
          }
        } catch {
          // Ignore
        }
      } else {
        console.error('[CallHandler] Error processing Plivo message:', error);
      }
    }
  }

  private handleTranscript(transcript: string, isFinal: boolean): void {
    if (this.isGenerating) {
      // User is speaking while we're generating - interrupt
      console.log('[CallHandler] User interrupted, stopping generation');
      this.heypixa?.close();
      this.isGenerating = false;
    }

    this.transcriptBuffer = transcript;
    this.session.currentTranscript = transcript;

    // Clear existing silence timeout
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }

    if (isFinal && transcript.trim()) {
      // User finished speaking - process after brief pause
      this.silenceTimeout = setTimeout(() => {
        this.processUserInput(this.transcriptBuffer);
        this.transcriptBuffer = '';
      }, 500);
    }
  }

  private async processUserInput(userMessage: string): Promise<void> {
    if (this.session.isProcessing || !userMessage.trim()) {
      return;
    }

    console.log(`[CallHandler] Processing user input: ${userMessage}`);
    this.session.isProcessing = true;
    this.isGenerating = true;

    try {
      // Get LLM response with streaming
      let responseText = '';

      await this.cerebras.generateResponse(
        this.session.conversationHistory,
        userMessage,
        {
          onChunk: (chunk) => {
            responseText += chunk;
          },
          onComplete: async (fullText) => {
            // Update conversation history
            this.session.conversationHistory.push(
              { role: 'user', content: userMessage },
              { role: 'assistant', content: fullText }
            );

            // Keep conversation history manageable (last 10 exchanges)
            if (this.session.conversationHistory.length > 20) {
              this.session.conversationHistory = this.session.conversationHistory.slice(-20);
            }

            // Synthesize speech
            await this.speakToUser(fullText);
          },
          onError: (error) => {
            console.error('[CallHandler] LLM error:', error);
            this.speakToUser('माफ़ कीजिए, कुछ गड़बड़ हो गई। कृपया दोबारा कोशिश करें।');
          },
        }
      );
    } catch (error) {
      console.error('[CallHandler] Error processing input:', error);
    } finally {
      this.session.isProcessing = false;
    }
  }

  private async speakToUser(text: string): Promise<void> {
    console.log(`[CallHandler] Speaking: ${text}`);

    try {
      this.heypixa = new HeyPixaTTS();

      await this.heypixa.connect({
        onAudioChunk: (audioBuffer) => {
          // Downsample and send to Plivo immediately for low latency
          const base64Audio = prepareAudioForPlivo(audioBuffer);
          this.sendAudioToPlivo(base64Audio);
        },
        onComplete: () => {
          console.log('[CallHandler] TTS synthesis complete');
          this.isGenerating = false;
          this.heypixa?.close();
          this.heypixa = null;
        },
        onError: (error) => {
          console.error('[CallHandler] TTS error:', error);
          this.isGenerating = false;
          this.heypixa?.close();
          this.heypixa = null;
        },
      });

      this.heypixa.synthesize(text);
    } catch (error) {
      console.error('[CallHandler] Failed to synthesize speech:', error);
      this.isGenerating = false;
    }
  }

  private sendAudioToPlivo(base64Audio: string): void {
    if (this.plivoWs.readyState !== WebSocket.OPEN) {
      console.warn('[CallHandler] Plivo WebSocket not open, cannot send audio');
      return;
    }

    const message: PlivoPlayAudioMessage = {
      event: 'playAudio',
      media: {
        contentType: 'audio/x-l16',
        sampleRate: 8000,
        payload: base64Audio,
      },
    };

    this.plivoWs.send(JSON.stringify(message));
  }

  async cleanup(): Promise<void> {
    console.log('[CallHandler] Cleaning up...');

    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }

    await this.deepgram.close();
    this.heypixa?.close();
  }
}
