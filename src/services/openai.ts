import { config } from '../config.js';
import type { CerebrasMessage } from '../types/index.js';

// Reuse the same message type (compatible with OpenAI)
export type ChatMessage = CerebrasMessage;

export class OpenAILLM {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private systemPrompt: string;

  constructor() {
    this.baseUrl = config.openai.baseUrl;
    this.apiKey = config.openai.apiKey;
    this.model = config.openai.model;
    this.systemPrompt = config.openai.systemPrompt;
  }

  // Non-streaming version with retry for rate limits
  async generate(
    conversationHistory: ChatMessage[],
    userMessage: string,
    maxRetries: number = 3
  ): Promise<string> {
    const messages: ChatMessage[] = [
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
            max_tokens: 500,
          }),
        });

        if (response.status === 429) {
          // Rate limited - wait and retry
          const waitTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          console.log(`[OpenAI] Rate limited, retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        console.log(`[OpenAI] Response: ${content}`);
        return content;
      } catch (error) {
        if (attempt === maxRetries - 1) throw error;
        console.log(`[OpenAI] Error, retrying (attempt ${attempt + 1}/${maxRetries}):`, error);
      }
    }

    // Fallback response if all retries fail
    return 'माफ़ कीजिए, कृपया फिर से कहें।';
  }
}
