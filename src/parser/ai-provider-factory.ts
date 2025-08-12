import { AIProvider, AIProviderConfig } from "./ai-provider";
import { OllamaProvider } from "./providers/ollama-provider";
import { OpenAIProvider } from "./providers/openai-provider";
import { ClaudeProvider } from "./providers/claude-provider";
import { GeminiProvider } from "./providers/gemini-provider";

/**
 * Supported AI Provider Types
 */
export type AIProviderType =
  | "ollama"
  | "openai"
  | "claude"
  | "gemini"
  | "azure"
  | "cohere";

/**
 * Complete AI Configuration Interface
 */
export interface AIConfig {
  provider: AIProviderType;
  apiKey?: string;
  endpoint?: string;
  model: string;
  maxRetries?: number;
  timeout?: number;
  options?: Record<string, any>;
}

/**
 * AI Provider Factory - Creates appropriate provider instances
 */
export class AIProviderFactory {
  /**
   * Create an AI provider instance based on configuration
   */
  static create(config: AIConfig): AIProvider {
    const providerConfig: AIProviderConfig = {
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      model: config.model,
      maxRetries: config.maxRetries || 3,
      timeout: config.timeout || 30000,
      options: config.options || {},
    };

    switch (config.provider) {
      case "ollama":
        return new OllamaProvider(providerConfig);

      case "openai":
        if (!config.apiKey) {
          throw new Error(
            "OpenAI API key is required. Set AI_API_KEY environment variable."
          );
        }
        return new OpenAIProvider(providerConfig);

      case "claude":
        if (!config.apiKey) {
          throw new Error(
            "Anthropic API key is required. Set AI_API_KEY environment variable."
          );
        }
        return new ClaudeProvider(providerConfig);

      case "gemini":
        if (!config.apiKey) {
          throw new Error(
            "Google AI API key is required. Set AI_API_KEY environment variable."
          );
        }
        return new GeminiProvider(providerConfig);

      case "azure":
        throw new Error(
          "Azure OpenAI provider not yet implemented. Coming soon!"
        );

      case "cohere":
        throw new Error("Cohere provider not yet implemented. Coming soon!");

      default:
        throw new Error(
          `Unsupported AI provider: ${config.provider}. Supported providers: ollama, openai, claude, gemini`
        );
    }
  }

  /**
   * Get default configuration for a provider
   */
  static getDefaultConfig(provider: AIProviderType): Partial<AIConfig> {
    switch (provider) {
      case "ollama":
        return {
          provider: "ollama",
          endpoint: "http://localhost:11434",
          model: "llama3.2:1b",
        };

      case "openai":
        return {
          provider: "openai",
          endpoint: "https://api.openai.com/v1",
          model: "gpt-3.5-turbo",
        };

      case "claude":
        return {
          provider: "claude",
          endpoint: "https://api.anthropic.com/v1",
          model: "claude-3-sonnet-20240229",
        };

      case "gemini":
        return {
          provider: "gemini",
          endpoint: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-pro",
        };

      default:
        throw new Error(
          `No default configuration available for provider: ${provider}`
        );
    }
  }

  /**
   * Create provider from environment variables
   */
  static createFromEnv(): AIProvider {
    const provider = (process.env.AI_PROVIDER || "ollama") as AIProviderType;
    const apiKey = process.env.AI_API_KEY;
    const endpoint = process.env.AI_ENDPOINT;
    const model = process.env.AI_MODEL;

    const defaultConfig = this.getDefaultConfig(provider);

    const config: AIConfig = {
      ...defaultConfig,
      provider,
      apiKey,
      endpoint: endpoint || defaultConfig.endpoint,
      model: model || defaultConfig.model!,
    };

    return this.create(config);
  }

  /**
   * Get list of supported providers
   */
  static getSupportedProviders(): AIProviderType[] {
    return ["ollama", "openai", "claude", "gemini"];
  }

  /**
   * Check if a provider is supported
   */
  static isProviderSupported(provider: string): provider is AIProviderType {
    return this.getSupportedProviders().includes(provider as AIProviderType);
  }

  /**
   * Get provider information
   */
  static getProviderInfo(provider: AIProviderType): {
    name: string;
    description: string;
    requiresApiKey: boolean;
    defaultModel: string;
  } {
    switch (provider) {
      case "ollama":
        return {
          name: "Ollama",
          description: "Local AI models (LLaMA, Mistral, CodeLlama, etc.)",
          requiresApiKey: false,
          defaultModel: "llama3.2:1b",
        };

      case "openai":
        return {
          name: "OpenAI",
          description: "GPT-3.5, GPT-4, and other OpenAI models",
          requiresApiKey: true,
          defaultModel: "gpt-3.5-turbo",
        };

      case "claude":
        return {
          name: "Anthropic Claude",
          description: "Claude 3 models (Haiku, Sonnet, Opus)",
          requiresApiKey: true,
          defaultModel: "claude-3-sonnet-20240229",
        };

      case "gemini":
        return {
          name: "Google Gemini",
          description: "Gemini Pro and other Google AI models",
          requiresApiKey: true,
          defaultModel: "gemini-pro",
        };

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
