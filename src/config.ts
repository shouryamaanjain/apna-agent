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

  // Cerebras
  cerebras: {
    apiKey: process.env.CEREBRAS_API_KEY || '',
    model: 'gpt-oss-120b',
    baseUrl: 'https://api.cerebras.ai/v1',
    systemPrompt: `तुम एक हिंदी असिस्टेंट हो। केवल हिंदी देवनागरी में संक्षिप्त उत्तर दो।`,
  },

  // HeyPixa TTS - Multiple checkpoint endpoints
  heypixa: {
    endpoints: {
      V1: process.env.HEYPIXA_ENDPOINT_V1 || 'wss://hindi.heypixa.ai/api/v1/ws/synthesize',
      V2: process.env.HEYPIXA_ENDPOINT_V2 || '',
      V3: process.env.HEYPIXA_ENDPOINT_V3 || '',
    } as Record<string, string>,
    activeCheckpoint: process.env.HEYPIXA_ACTIVE_CHECKPOINT || 'V1',
    voice: process.env.HEYPIXA_VOICE || 'kriti',
    sampleRate: 32000, // HeyPixa outputs 32kHz
  },

  // Server
  server: {
    host: process.env.SERVER_HOST || 'localhost:3000',
    port: parseInt(process.env.PORT || '3000', 10),
  },

  // Audio settings
  audio: {
    plivoSampleRate: 8000, // Plivo expects 8kHz
    heypixaSampleRate: 32000, // HeyPixa outputs 32kHz
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
