import 'dotenv/config';

export const config = {
  // Plivo
  plivo: {
    authId: process.env.PLIVO_AUTH_ID || '',
    authToken: process.env.PLIVO_AUTH_TOKEN || '',
  },

  // Deepgram
  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY || '',
    model: 'nova-2',
    language: 'hi', // Hindi with Devanagari output
  },

  // OpenAI
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4.1-nano-2025-04-14',
    baseUrl: 'https://api.openai.com/v1',
    systemPrompt: `तुम एक हिंदी असिस्टेंट हो। केवल हिंदी देवनागरी में संक्षिप्त उत्तर दो।`,
  },

  // TTS Provider selection
  tts: {
    provider: process.env.TTS_PROVIDER || 'heypixa', // 'heypixa' or 'elevenlabs'
    // Route TTS based on called number
    elevenLabsNumber: process.env.ELEVENLABS_PHONE_NUMBER || '918035451536',
    heypixaNumber: process.env.HEYPIXA_PHONE_NUMBER || '912268093678',
  },

  // HeyPixa TTS - Multiple checkpoint endpoints
  heypixa: {
    endpoints: {
      V1: process.env.HEYPIXA_ENDPOINT_V1 || 'wss://hindi.heypixa.ai/api/v1/ws/synthesize',
      V2: process.env.HEYPIXA_ENDPOINT_V2 || '',
      V3: process.env.HEYPIXA_ENDPOINT_V3 || '',
    } as Record<string, string>,
    activeCheckpoint: process.env.HEYPIXA_ACTIVE_CHECKPOINT || 'V1',
    voice: process.env.HEYPIXA_VOICE || 'neha',
    sampleRate: 32000, // HeyPixa outputs 32kHz
  },

  // ElevenLabs TTS
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || '',
    voiceId: process.env.ELEVENLABS_VOICE_ID || 'gWIZtiCcYnvLguTazwbO', // devi
    modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5',
    sampleRate: 16000, // Using pcm_16000
  },

  // Server
  server: {
    host: process.env.SERVER_HOST || 'localhost:3000',
    port: parseInt(process.env.PORT || '3000', 10),
  },

  // Audio settings
  audio: {
    plivoInboundSampleRate: 8000, // Plivo sends inbound audio at 8kHz (user's voice)
    plivoOutboundSampleRate: 16000, // We send outbound audio at 16kHz (TTS to user)
    heypixaSampleRate: 32000, // HeyPixa outputs 32kHz (downsampled to 16kHz)
    elevenlabsSampleRate: 16000, // ElevenLabs outputs 16kHz (no resampling needed)
  },
};

// Get active HeyPixa endpoint
export function getActiveHeyPixaEndpoint(): string {
  const endpoint = config.heypixa.endpoints[config.heypixa.activeCheckpoint];
  if (!endpoint) {
    throw new Error(`HeyPixa endpoint not configured for checkpoint: ${config.heypixa.activeCheckpoint}`);
  }
  return endpoint;
}
