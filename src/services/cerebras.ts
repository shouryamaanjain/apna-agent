import { config } from '../config.js';
import type { CerebrasMessage } from '../types/index.js';

export interface StreamCallback {
  onChunk: (text: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
}

export class CerebrasLLM {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private systemPrompt: string;

  constructor() {
    this.baseUrl = config.cerebras.baseUrl;
    this.apiKey = config.cerebras.apiKey;
    this.model = config.cerebras.model;
    this.systemPrompt = config.cerebras.systemPrompt;
  }

  async generateResponse(
    conversationHistory: CerebrasMessage[],
    userMessage: string,
    callbacks: StreamCallback
  ): Promise<string> {
    const messages: CerebrasMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ];

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          max_completion_tokens: 500,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cerebras API error: ${response.status} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullText += content;
                callbacks.onChunk(content);
              }
            } catch {
              // Skip malformed JSON chunks
            }
          }
        }
      }

      console.log(`[Cerebras] Response: ${fullText}`);
      callbacks.onComplete(fullText);
      return fullText;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('[Cerebras] Error:', err);
      callbacks.onError(err);
      throw err;
    }
  }

  // Non-streaming version with retry for rate limits
  async generate(
    conversationHistory: CerebrasMessage[],
    userMessage: string,
    maxRetries: number = 3
  ): Promise<string> {
    const messages: CerebrasMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            max_completion_tokens: 500,
          }),
        });

        if (response.status === 429) {
          // Rate limited - wait and retry
          const waitTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          console.log(`[Cerebras] Rate limited, retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Cerebras API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
      } catch (error) {
        if (attempt === maxRetries - 1) throw error;
        console.log(`[Cerebras] Error, retrying (attempt ${attempt + 1}/${maxRetries}):`, error);
      }
    }

    // Fallback response if all retries fail
    return 'माफ़ कीजिए, कृपया फिर से कहें।';
  }
}
