import {
  BaseAIProvider,
  CompletionRequest,
  CompletionResponse,
  AIProviderConfig,
} from "../ai-provider";

/**
 * Anthropic Claude Provider - Supports Claude 3 models
 * Requires API key from https://console.anthropic.com/
 */
export class ClaudeProvider extends BaseAIProvider {
  private static readonly DEFAULT_ENDPOINT = "https://api.anthropic.com/v1";
  private static readonly DEFAULT_MODEL = "claude-3-sonnet-20240229";
  private static readonly API_VERSION = "2023-06-01";

  constructor(config: AIProviderConfig) {
    super({
      endpoint: ClaudeProvider.DEFAULT_ENDPOINT,
      ...config,
      model: config.model || ClaudeProvider.DEFAULT_MODEL,
    });
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error(
        "Anthropic API key is required. Set AI_API_KEY environment variable."
      );
    }

    try {
      await this.healthCheck();
      this.isInitialized = true;
      console.log(
        `Claude Provider initialized with model: ${this.config.model}`
      );
    } catch (error) {
      throw new Error(`Failed to initialize Claude provider: ${error}`);
    }
  }

  async generateCompletion(
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    const startTime = Date.now();

    return this.retryOperation(async () => {
      const systemPrompt =
        "You are a helpful assistant that converts natural language into structured load test specifications. Always respond with valid JSON when requested.";

      const response = await fetch(`${this.config.endpoint}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey!,
          "Content-Type": "application/json",
          "anthropic-version": ClaudeProvider.API_VERSION,
        },
        body: JSON.stringify({
          model: request.model || this.config.model,
          max_tokens: request.maxTokens || 2000,
          temperature: request.temperature || 0.1,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: request.prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as any;
        throw new Error(
          `Claude API error: ${response.status} - ${
            errorData.error?.message || response.statusText
          }`
        );
      }

      const data = (await response.json()) as any;
      const duration = Date.now() - startTime;

      return {
        response: data.content[0].text,
        model: data.model,
        usage: {
          promptTokens: data.usage?.input_tokens,
          completionTokens: data.usage?.output_tokens,
          totalTokens:
            (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        },
        metadata: {
          provider: "claude",
          duration,
        },
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Claude doesn't have a simple health check endpoint, so we make a minimal request
      const response = await fetch(`${this.config.endpoint}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey!,
          "Content-Type": "application/json",
          "anthropic-version": ClaudeProvider.API_VERSION,
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 10,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  getProviderName(): string {
    return "Anthropic Claude";
  }
}
