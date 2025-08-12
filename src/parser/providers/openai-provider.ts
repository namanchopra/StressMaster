import {
  BaseAIProvider,
  CompletionRequest,
  CompletionResponse,
  AIProviderConfig,
} from "../ai-provider";

/**
 * OpenAI Provider - Supports GPT-3.5, GPT-4, and other OpenAI models
 * Requires API key from https://platform.openai.com/api-keys
 */
export class OpenAIProvider extends BaseAIProvider {
  private static readonly DEFAULT_ENDPOINT = "https://api.openai.com/v1";
  private static readonly DEFAULT_MODEL = "gpt-3.5-turbo";

  constructor(config: AIProviderConfig) {
    super({
      endpoint: OpenAIProvider.DEFAULT_ENDPOINT,
      ...config,
      model: config.model || OpenAIProvider.DEFAULT_MODEL,
    });
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error(
        "OpenAI API key is required. Set AI_API_KEY environment variable."
      );
    }

    // Test the API key with a simple request
    try {
      await this.healthCheck();
      this.isInitialized = true;
      console.log(
        `OpenAI Provider initialized with model: ${this.config.model}`
      );
    } catch (error) {
      throw new Error(`Failed to initialize OpenAI provider: ${error}`);
    }
  }

  async generateCompletion(
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    const startTime = Date.now();

    return this.retryOperation(async () => {
      const response = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model || this.config.model,
          messages: [
            {
              role: "system",
              content:
                "You are a helpful assistant that converts natural language into structured load test specifications. Always respond with valid JSON.",
            },
            {
              role: "user",
              content: request.prompt,
            },
          ],
          temperature: request.temperature || 0.1,
          max_tokens: request.maxTokens || 2000,
          response_format:
            request.format === "json" ? { type: "json_object" } : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as any;
        throw new Error(
          `OpenAI API error: ${response.status} - ${
            errorData.error?.message || response.statusText
          }`
        );
      }

      const data = (await response.json()) as any;
      const duration = Date.now() - startTime;

      return {
        response: data.choices[0].message.content,
        model: data.model,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        },
        metadata: {
          provider: "openai",
          duration,
        },
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.endpoint}/models`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  getProviderName(): string {
    return "OpenAI";
  }
}
