import {
  BaseAIProvider,
  CompletionRequest,
  CompletionResponse,
  AIProviderConfig,
} from "../ai-provider";
import { OllamaClient } from "../ollama-client";

/**
 * Ollama Provider - Supports local Ollama models (LLaMA, Mistral, CodeLlama, etc.)
 * Requires Ollama to be running locally or on specified endpoint
 */
export class OllamaProvider extends BaseAIProvider {
  private static readonly DEFAULT_ENDPOINT = "http://localhost:11434";
  private static readonly DEFAULT_MODEL = "llama3.2:1b";

  private ollamaClient: OllamaClient;

  constructor(config: AIProviderConfig) {
    super({
      endpoint: OllamaProvider.DEFAULT_ENDPOINT,
      ...config,
      model: config.model || OllamaProvider.DEFAULT_MODEL,
    });

    this.ollamaClient = new OllamaClient({
      ollamaEndpoint: this.config.endpoint!,
      modelName: this.config.model,
      maxRetries: this.config.maxRetries || 3,
      timeout: this.config.timeout || 30000,
    });
  }

  async initialize(): Promise<void> {
    try {
      // Check if Ollama service is available
      const isHealthy = await this.ollamaClient.healthCheck();
      if (!isHealthy) {
        throw new Error("Ollama service is not available");
      }

      // Check if model is available
      const isModelAvailable = await this.ollamaClient.checkModelAvailability(
        this.config.model
      );
      if (!isModelAvailable) {
        console.log(
          `Model ${this.config.model} not found, attempting to pull...`
        );
        await this.ollamaClient.pullModel(this.config.model);
      }

      this.isInitialized = true;
      console.log(
        `Ollama Provider initialized with model: ${this.config.model}`
      );
    } catch (error) {
      throw new Error(`Failed to initialize Ollama provider: ${error}`);
    }
  }

  async generateCompletion(
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    const startTime = Date.now();

    return this.retryOperation(async () => {
      const response = await this.ollamaClient.generateCompletion({
        model: request.model || this.config.model,
        prompt: request.prompt,
        format: request.format === "json" ? "json" : undefined,
        options: {
          temperature: request.temperature || 0.1,
          top_p: 0.9,
          num_predict: request.maxTokens || 2000,
          ...request.options,
        },
      });

      const duration = Date.now() - startTime;

      return {
        response: response.response,
        model: response.model,
        usage: {
          promptTokens: response.prompt_eval_count,
          completionTokens: response.eval_count,
          totalTokens:
            (response.prompt_eval_count || 0) + (response.eval_count || 0),
        },
        metadata: {
          provider: "ollama",
          duration,
          cached: response.load_duration === 0,
        },
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    return this.ollamaClient.healthCheck();
  }

  getProviderName(): string {
    return "Ollama";
  }

  // Ollama-specific methods
  async pullModel(modelName: string): Promise<void> {
    await this.ollamaClient.pullModel(modelName);
  }
}
