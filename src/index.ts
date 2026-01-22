import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.js';
import plivoRoutes from './routes/plivo.js';
import { CallHandler } from './handlers/call-handler.js';

const app = express();
const server = createServer(app);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    ttsProvider: config.tts.provider,
    heypixa: {
      checkpoint: config.heypixa.activeCheckpoint,
      voice: config.heypixa.voice,
    },
    elevenlabs: {
      voiceId: config.elevenlabs.voiceId,
      modelId: config.elevenlabs.modelId,
    },
  });
});

// Plivo routes
app.use('/', plivoRoutes);

// WebSocket server for Plivo media streams
const wss = new WebSocketServer({ server, path: '/media-stream' });

wss.on('connection', async (ws: WebSocket, req) => {
  console.log('[WebSocket] New connection from:', req.socket.remoteAddress);

  // Extract 'to' number from query params for TTS routing
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const calledNumber = url.searchParams.get('to') || '';
  console.log(`[WebSocket] Called number: ${calledNumber}`);

  const callHandler = new CallHandler(ws, calledNumber);

  try {
    await callHandler.initialize();

    ws.on('message', (data, isBinary) => {
      callHandler.handlePlivoMessage(data, isBinary);
    });

    ws.on('close', () => {
      console.log('[WebSocket] Connection closed');
      callHandler.cleanup();
    });

    ws.on('error', (error) => {
      console.error('[WebSocket] Error:', error);
      callHandler.cleanup();
    });
  } catch (error) {
    console.error('[WebSocket] Failed to initialize call handler:', error);
    ws.close();
  }
});

// Start server
server.listen(config.server.port, () => {
  const ttsInfo = config.tts.provider === 'elevenlabs'
    ? `ElevenLabs (${config.elevenlabs.modelId})`
    : `HeyPixa (${config.heypixa.activeCheckpoint})`;

  console.log(`
╔════════════════════════════════════════════════════════════╗
║           Hindi Voice Agent - ApnaAgent                    ║
╠════════════════════════════════════════════════════════════╣
║  Server running on port ${config.server.port}                              ║
║  TTS Provider: ${ttsInfo.padEnd(42)}║
╠════════════════════════════════════════════════════════════╣
║  Endpoints:                                                ║
║  - POST /incoming-call  (Plivo webhook)                    ║
║  - WS   /media-stream   (Plivo audio stream)               ║
║  - GET  /health         (Health check)                     ║
╚════════════════════════════════════════════════════════════╝

Configure your Plivo number webhook to:
  https://<your-domain>/incoming-call

For local development, use ngrok:
  ngrok http ${config.server.port}
  `);
});
