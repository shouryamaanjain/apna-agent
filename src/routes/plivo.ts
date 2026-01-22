import { Router, Request, Response } from 'express';
import { config } from '../config.js';

const router = Router();

/**
 * POST /incoming-call
 * Plivo webhook endpoint for incoming calls
 * Returns XML to start bidirectional audio streaming
 */
router.post('/incoming-call', (req: Request, res: Response) => {
  console.log('[Plivo] Incoming call received');
  console.log('[Plivo] Call details:', {
    from: req.body.From,
    to: req.body.To,
    callUuid: req.body.CallUUID,
  });

  // Determine WebSocket URL (use wss:// for production, ws:// for local)
  // Include 'to' number as query param for TTS routing
  const wsProtocol = config.server.host.includes('localhost') ? 'ws' : 'wss';
  const toNumber = req.body.To || '';
  const wsUrl = `${wsProtocol}://${config.server.host}/media-stream?to=${encodeURIComponent(toNumber)}`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">
    ${wsUrl}
  </Stream>
</Response>`;

  console.log('[Plivo] Responding with Stream XML:', wsUrl);
  res.type('application/xml').send(xml);
});

/**
 * POST /incoming-call-test
 * Simple test endpoint - just speaks a message (no WebSocket)
 */
router.post('/incoming-call-test', (req: Request, res: Response) => {
  console.log('[Plivo] TEST call received:', req.body);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="hi-IN">नमस्ते! यह एक टेस्ट कॉल है। आपका कॉल सफलतापूर्वक कनेक्ट हो गया है।</Speak>
</Response>`;

  res.type('application/xml').send(xml);
});

/**
 * POST /call-status
 * Plivo webhook for call status updates
 */
router.post('/call-status', (req: Request, res: Response) => {
  console.log('[Plivo] Call status update:', {
    callUuid: req.body.CallUUID,
    status: req.body.Status,
    duration: req.body.Duration,
  });
  res.sendStatus(200);
});

/**
 * POST /stream-status
 * Plivo webhook for stream status updates
 */
router.post('/stream-status', (req: Request, res: Response) => {
  console.log('[Plivo] Stream status update:', req.body);
  res.sendStatus(200);
});

export default router;
