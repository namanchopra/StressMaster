import { LoadTestSpec, ValidationResult } from "../types";
import { PromptTemplateManager } from "./prompt-templates";
import { ResponseParser } from "./response-parser";
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
import { FallbackParser } from "./fallback-parser";
import { AIProvider } from "./ai-provider";
import { AIProviderFactory, AIConfig } from "./ai-provider-factory";
import { CommandParser, ParseResult } from "./command-parser";

/**
 * Universal Command Parser - Works with any AI provider (Ollama, OpenAI, Claude, Gemini, etc.)
 * This is the future-ready parser that supports multiple AI providers
 */
export class UniversalCommandParser implements CommandParser {
  private aiProvider: AIProvider;
  private config: AIConfig;
  private isReady: boolean = false;

  constructor(config: AIConfig) {
    this.config = config;
    this.aiProvider = AIProviderFactory.create(config);
  }

  /**
   * Initialize the AI provider
   */
  async initialize(): Promise<void> {
    try {
      await this.aiProvider.initialize();
      this.isReady = true;
      console.log(
        `Universal Command Parser initialized with ${this.aiProvider.getProviderName()}`
      );
    } catch (error) {
      console.warn(
        `Failed to initialize ${this.aiProvider.getProviderName()}: ${error}`
      );
      this.isReady = false;
    }
  }

  /**
   * Parse natural language command into LoadTestSpec
   */
  async parseCommand(naturalLanguageInput: string): Promise<LoadTestSpec> {
    try {
      // If AI provider is not ready, use fallback parsing
      if (!this.isReady) {
        console.warn(
          `${this.aiProvider.getProviderName()} not ready, using fallback parsing`
        );
        return this.enhancedFallbackParsing(naturalLanguageInput);
      }

      // Generate prompt using template
      const prompt =
        PromptTemplateManager.buildFullPrompt(naturalLanguageInput);

      // Call AI provider with standardized request
      const response = await this.aiProvider.generateCompletion({
        prompt,
        format: "json",
        temperature: 0.1,
        maxTokens: 500,
      });

      // Parse the response (works with any provider)
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
        return this.enhancedFallbackParsing(naturalLanguageInput);
      }

      return parsedResponse.spec;
    } catch (error) {
      console.error(
        `Error parsing command with ${this.aiProvider.getProviderName()}:`,
        error
      );
      return this.enhancedFallbackParsing(naturalLanguageInput);
    }
  }

  /**
   * Parse command with detailed results and confidence scores
   */
  async parseCommandWithDetails(
    naturalLanguageInput: string
  ): Promise<ParseResult> {
    try {
      if (!this.isReady) {
        const fallbackSpec = this.fallbackParsing(naturalLanguageInput);
        return {
          spec: fallbackSpec,
          confidence: 0.3,
          ambiguities: [
            `${this.aiProvider.getProviderName()} not available, using fallback parsing`,
          ],
          suggestions: [
            `Ensure ${this.aiProvider.getProviderName()} is properly configured`,
          ],
        };
      }

      const prompt =
        PromptTemplateManager.buildFullPrompt(naturalLanguageInput);
      const response = await this.aiProvider.generateCompletion({
        prompt,
        format: "json",
        temperature: 0.1,
        maxTokens: 500,
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
      console.error(
        `Error parsing command with ${this.aiProvider.getProviderName()}:`,
        error
      );
      const fallbackSpec = this.fallbackParsing(naturalLanguageInput);
      return {
        spec: fallbackSpec,
        confidence: 0.2,
        ambiguities: [
          `${this.aiProvider.getProviderName()} parsing failed`,
          error instanceof Error ? error.message : String(error),
        ],
        suggestions: [
          "Try rephrasing your command",
          `Check ${this.aiProvider.getProviderName()} configuration`,
        ],
      };
    }
  }

  /**
   * Validate a LoadTestSpec
   */
  validateSpec(spec: LoadTestSpec): ValidationResult {
    return ResponseParser.validateParsedSpec(spec);
  }

  /**
   * Suggest corrections for failed parsing
   */
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

  /**
   * Parse command with detailed suggestions
   */
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

  /**
   * Generate interactive questions for clarification
   */
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

  /**
   * Check if fallback parsing is possible
   */
  canFallbackParse(input: string): boolean {
    return FallbackParser.canParse(input);
  }

  /**
   * Get fallback parsing confidence
   */
  getFallbackConfidence(input: string): number {
    return FallbackParser.getConfidenceScore(input);
  }

  /**
   * Check if the parser is ready
   */
  isParserReady(): boolean {
    return this.isReady;
  }

  /**
   * Get AI provider information
   */
  getProviderInfo(): {
    name: string;
    isReady: boolean;
    config: AIConfig;
  } {
    return {
      name: this.aiProvider.getProviderName(),
      isReady: this.isReady,
      config: this.config,
    };
  }

  /**
   * Health check for the AI provider
   */
  async healthCheck(): Promise<boolean> {
    try {
      return await this.aiProvider.healthCheck();
    } catch (error) {
      return false;
    }
  }

  // Private helper methods

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

  private fallbackParsing(input: string): LoadTestSpec {
    // Basic rule-based parsing for common patterns
    const spec: LoadTestSpec = {
      id: `test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
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
}
