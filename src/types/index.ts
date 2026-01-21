// Plivo WebSocket message types
export interface PlivoMediaMessage {
  event: 'media';
  media: {
    track: 'inbound' | 'outbound';
    chunk: number; // sequence number
    timestamp: string;
    payload: string; // base64 encoded audio
  };
  streamId: string;
}

export interface PlivoStartMessage {
  event: 'start';
  start: {
    streamId: string;
    callId: string;
    tracks: string[];
  };
}

export interface PlivoStopMessage {
  event: 'stop';
  streamId: string;
}

export type PlivoInboundMessage = PlivoMediaMessage | PlivoStartMessage | PlivoStopMessage;

// Message to send audio back to Plivo
export interface PlivoPlayAudioMessage {
  event: 'playAudio';
  media: {
    contentType: 'audio/x-l16' | 'audio/x-mulaw';
    sampleRate: 8000 | 16000;
    payload: string; // base64 encoded audio
  };
}

// Deepgram response types
export interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word: string;
}

export interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words: DeepgramWord[];
}

export interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

export interface DeepgramResult {
  type: 'Results';
  channel_index: number[];
  duration: number;
  start: number;
  is_final: boolean;
  speech_final: boolean;
  channel: DeepgramChannel;
}

// Cerebras types
export interface CerebrasMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CerebrasStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
      role?: string;
    };
    finish_reason: string | null;
  }>;
}

// HeyPixa WebSocket message types
export interface HeyPixaConfigMessage {
  type: 'config';
  voice?: string;
  top_p?: number;
  repetition_penalty?: number;
}

export interface HeyPixaTextMessage {
  type: 'text';
  content: string;
  is_final: boolean;
}

export interface HeyPixaStatusMessage {
  type: 'status' | 'done' | 'error';
  message: string;
  status?: string;
  config?: Record<string, unknown>;
}

// Call session state
export interface CallSession {
  callId: string;
  streamId: string;
  conversationHistory: CerebrasMessage[];
  isProcessing: boolean;
  currentTranscript: string;
}
