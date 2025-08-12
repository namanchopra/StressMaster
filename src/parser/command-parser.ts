import { LoadTestSpec, ValidationResult } from "../types";
import { OllamaClient, ConnectionPoolConfig } from "./ollama-client";
import { PromptTemplateManager } from "./prompt-templates";
import { ResponseParser, ParsedResponse } from "./response-parser";
import {
  CommandValidator,
  EnhancedValidationResult,
  ValidationContext,
} from "./command-validator";
import {
  SuggestionEngine,
  SuggestionContext,
  Suggestion,
} from "./suggestion-engine";
import { FallbackParser, FallbackParseResult } from "./fallback-parser";
import { AIProvider } from "./ai-provider";
import { AIProviderFactory, AIConfig } from "./ai-provider-factory";

export interface CommandParser {
  parseCommand(naturalLanguageInput: string): Promise<LoadTestSpec>;
  validateSpec(spec: LoadTestSpec): ValidationResult;
  suggestCorrections(input: string, errors: string[]): string[];
}

export interface ParserConfig {
  ollamaEndpoint: string;
  modelName: string;
  maxRetries: number;
  timeout: number;
}

export interface ParseResult {
  spec: LoadTestSpec;
  confidence: number;
  ambiguities: string[];
  suggestions: string[];
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class AICommandParser implements CommandParser {
  private ollamaClient: OllamaClient;
  private config: ParserConfig;
  private isModelReady: boolean = false;

  constructor(
    config: ParserConfig,
    poolConfig?: Partial<ConnectionPoolConfig>
  ) {
    this.config = config;
    this.ollamaClient = new OllamaClient(config, poolConfig);
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
        this.config.modelName
      );
      if (!isModelAvailable) {
        console.log(
          `Model ${this.config.modelName} not found, attempting to pull...`
        );
        await this.ollamaClient.pullModel(this.config.modelName);
      }

      this.isModelReady = true;
      console.log(
        `AI Command Parser initialized with model: ${this.config.modelName}`
      );
    } catch (error) {
      console.warn(`Failed to initialize AI Command Parser: ${error}`);
      this.isModelReady = false;
    }
  }

  async parseCommand(naturalLanguageInput: string): Promise<LoadTestSpec> {
    try {
      // If AI is not ready, use fallback parsing
      if (!this.isModelReady) {
        console.warn("AI model not ready, using fallback parsing");
        return this.enhancedFallbackParsing(naturalLanguageInput);
      }

      // Generate prompt using template
      const prompt =
        PromptTemplateManager.buildFullPrompt(naturalLanguageInput);

      // Call Ollama API with enhanced error handling
      const response = await this.ollamaClient.generateCompletion({
        model: this.config.modelName,
        prompt,
        format: "json",
        options: {
          temperature: 0.1, // Low temperature for consistent parsing
          top_p: 0.9,
          num_predict: 500, // Reduced for faster response
        },
      });

      // Parse the response
      const parsedResponse = ResponseParser.parseOllamaResponse(
        response.response,
        naturalLanguageInput
      );

      // Enhanced validation with context
      const validationResult = this.validateSpecWithContext(
        parsedResponse.spec,
        naturalLanguageInput,
        parsedResponse.confidence,
        parsedResponse.ambiguities
      );

      if (!validationResult.canProceed) {
        console.warn("Parsed spec validation failed:", validationResult.errors);
        // Try to fix common issues or fall back
        return this.enhancedFallbackParsing(naturalLanguageInput);
      }

      return parsedResponse.spec;
    } catch (error) {
      console.error("Error parsing command with AI:", error);

      // Check if we can gracefully degrade
      const degradationStrategy =
        this.ollamaClient.getGracefulDegradationStrategy();
      if (degradationStrategy.canDegrade) {
        console.log(
          `Using graceful degradation strategy: ${degradationStrategy.strategy}`
        );
        console.log(
          `Confidence: ${
            degradationStrategy.confidence
          }, Limitations: ${degradationStrategy.limitations.join(", ")}`
        );
      }

      return this.enhancedFallbackParsing(naturalLanguageInput);
    }
  }

  async parseCommandWithDetails(
    naturalLanguageInput: string
  ): Promise<ParseResult> {
    try {
      if (!this.isModelReady) {
        const fallbackSpec = this.fallbackParsing(naturalLanguageInput);
        return {
          spec: fallbackSpec,
          confidence: 0.3,
          ambiguities: ["AI model not available, using fallback parsing"],
          suggestions: [
            "Ensure Ollama service is running and model is available",
          ],
        };
      }

      const prompt =
        PromptTemplateManager.buildFullPrompt(naturalLanguageInput);
      const response = await this.ollamaClient.generateCompletion({
        model: this.config.modelName,
        prompt,
        format: "json",
        options: {
          temperature: 0.1,
          top_p: 0.9,
          num_predict: 2000, // Reduced for faster response
        },
      });

      const parsedResponse = ResponseParser.parseOllamaResponse(
        response.response,
        naturalLanguageInput
      );

      return {
        spec: parsedResponse.spec,
        confidence: parsedResponse.confidence,
        ambiguities: parsedResponse.ambiguities,
        suggestions: parsedResponse.suggestions,
      };
    } catch (error) {
      console.error("Error parsing command with AI:", error);
      const fallbackSpec = this.fallbackParsing(naturalLanguageInput);
      return {
        spec: fallbackSpec,
        confidence: 0.2,
        ambiguities: [
          "AI parsing failed",
          error instanceof Error ? error.message : String(error),
        ],
        suggestions: [
          "Try rephrasing your command",
          "Check Ollama service status",
        ],
      };
    }
  }

  validateSpec(spec: LoadTestSpec): ValidationResult {
    return ResponseParser.validateParsedSpec(spec);
  }

  suggestCorrections(input: string, errors: string[]): string[] {
    const suggestions: string[] = [];

    errors.forEach((error) => {
      if (error.includes("URL")) {
        suggestions.push(
          "Include the complete API endpoint URL (e.g., https://api.example.com/endpoint)"
        );
      }
      if (error.includes("method")) {
        suggestions.push(
          "Specify the HTTP method (GET, POST, PUT, DELETE, etc.)"
        );
      }
      if (
        error.includes("virtual users") ||
        error.includes("requests per second")
      ) {
        suggestions.push(
          'Specify load parameters like "100 users" or "50 requests per second"'
        );
      }
      if (error.includes("duration")) {
        suggestions.push(
          'Include test duration like "for 5 minutes" or "30 seconds"'
        );
      }
    });

    // Add general suggestions based on input analysis
    const lowerInput = input.toLowerCase();
    if (!lowerInput.includes("http") && !lowerInput.includes("/")) {
      suggestions.push("Include the API endpoint URL you want to test");
    }
    if (!lowerInput.match(/\d+/)) {
      suggestions.push(
        "Include specific numbers for load parameters (users, requests, duration)"
      );
    }

    return suggestions;
  }

  private fallbackParsing(input: string): LoadTestSpec {
    // Basic rule-based parsing for common patterns
    const spec: LoadTestSpec = {
      id: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: `Load Test - ${new Date().toISOString()}`,
      description: input,
      testType: PromptTemplateManager.inferTestType(input) as any,
      requests: [
        {
          method: PromptTemplateManager.inferHttpMethod(input) as any,
          url: this.extractUrlFromInput(input) || "/api/endpoint",
          headers: ["POST", "PUT", "PATCH"].includes(
            PromptTemplateManager.inferHttpMethod(input)
          )
            ? { "Content-Type": "application/json" }
            : undefined,
        },
      ],
      loadPattern: {
        type: "constant",
        virtualUsers: PromptTemplateManager.extractRequestCount(input),
      },
      duration: PromptTemplateManager.extractDuration(input),
    };

    return spec;
  }

  private extractUrlFromInput(input: string): string | null {
    const urlPattern = /(https?:\/\/[^\s]+|\/[^\s]*)/;
    const match = input.match(urlPattern);
    return match ? match[0] : null;
  }

  getConnectionStats(): { active: number; queued: number } {
    return {
      active: this.ollamaClient.getActiveConnections(),
      queued: this.ollamaClient.getQueueLength(),
    };
  }

  isReady(): boolean {
    return this.isModelReady;
  }

  private validateSpecWithContext(
    spec: LoadTestSpec,
    originalInput: string,
    confidence: number,
    ambiguities: string[]
  ): EnhancedValidationResult {
    const context: ValidationContext = {
      originalInput,
      confidence,
      ambiguities,
    };

    return CommandValidator.validateLoadTestSpec(spec, context);
  }

  private enhancedFallbackParsing(input: string): LoadTestSpec {
    // Try enhanced fallback parsing first
    if (FallbackParser.canParse(input)) {
      const fallbackResult = FallbackParser.parseCommand(input);

      // Validate the fallback result
      const validationResult = this.validateSpecWithContext(
        fallbackResult.spec,
        input,
        fallbackResult.confidence,
        []
      );

      if (validationResult.canProceed) {
        return fallbackResult.spec;
      }
    }

    // Fall back to basic parsing if enhanced fallback fails
    return this.fallbackParsing(input);
  }

  async parseCommandWithSuggestions(
    naturalLanguageInput: string
  ): Promise<ParseResult & { detailedSuggestions: Suggestion[] }> {
    const parseResult = await this.parseCommandWithDetails(
      naturalLanguageInput
    );

    // Generate detailed suggestions
    const validationResult = this.validateSpecWithContext(
      parseResult.spec,
      naturalLanguageInput,
      parseResult.confidence,
      parseResult.ambiguities
    );

    const suggestionContext: SuggestionContext = {
      originalInput: naturalLanguageInput,
      parsedSpec: parseResult.spec,
      validationIssues: validationResult.issues,
      confidence: parseResult.confidence,
      ambiguities: parseResult.ambiguities,
    };

    const detailedSuggestions =
      SuggestionEngine.generateSuggestions(suggestionContext);

    return {
      ...parseResult,
      detailedSuggestions,
    };
  }

  generateInteractiveQuestions(input: string, spec?: LoadTestSpec): string[] {
    const context: SuggestionContext = {
      originalInput: input,
      parsedSpec: spec,
      validationIssues: [],
      confidence: spec ? 0.7 : 0.3,
      ambiguities: [],
    };

    return SuggestionEngine.generateInteractiveQuestions(context);
  }

  canFallbackParse(input: string): boolean {
    return FallbackParser.canParse(input);
  }

  getFallbackConfidence(input: string): number {
    return FallbackParser.getConfidenceScore(input);
  }

  /**
   * Gets comprehensive error statistics and diagnostics from the AI service
   */
  getErrorStatistics() {
    return this.ollamaClient.getErrorStatistics();
  }

  /**
   * Gets current service health status
   */
  getServiceHealth() {
    return this.ollamaClient.getServiceHealth();
  }

  /**
   * Clears error diagnostics and resets error tracking
   */
  clearDiagnostics(): void {
    this.ollamaClient.clearDiagnostics();
  }

  /**
   * Gets graceful degradation strategy for current service state
   */
  getGracefulDegradationStrategy() {
    return this.ollamaClient.getGracefulDegradationStrategy();
  }
}
