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

  // Streaming version with TTFT logging
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

    const startTime = Date.now();

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
            stream: true,
          }),
        });

        if (response.status === 429) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`[OpenAI] Rate limited, retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let fullText = '';
        let firstTokenReceived = false;

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
                  if (!firstTokenReceived) {
                    firstTokenReceived = true;
                    const ttft = Date.now() - startTime;
                    console.log(`[Latency] LLM TTFT (Time to First Token): ${ttft}ms`);
                  }
                  fullText += content;
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }

        const totalTime = Date.now() - startTime;
        console.log(`[Latency] LLM Total: ${totalTime}ms`);
        console.log(`[OpenAI] Response: ${fullText}`);
        return fullText;
      } catch (error) {
        if (attempt === maxRetries - 1) throw error;
        console.log(`[OpenAI] Error, retrying (attempt ${attempt + 1}/${maxRetries}):`, error);
      }
    }

    return 'माफ़ कीजिए, कृपया फिर से कहें।';
  }
}
