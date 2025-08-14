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
import {
  CommandParser,
  ParseResult,
  DetailedParseResult,
} from "./command-parser";
import {
  DefaultInputPreprocessor,
  InputPreprocessor,
  StructuredData,
} from "./input-preprocessor";
import { FormatDetector, FormatDetectionResult } from "./format-detector";
import {
  DefaultContextEnhancer,
  ContextEnhancer,
  ParseContext,
} from "./context-enhancer";
import {
  DefaultSmartPromptBuilder,
  SmartPromptBuilder,
  EnhancedPrompt,
} from "./smart-prompt-builder";
import {
  SmartAIProvider,
  SmartParseResponse,
  ParseExplanation,
} from "./smart-ai-provider";

/**
 * Universal Command Parser - Works with any AI provider (Ollama, OpenAI, Claude, Gemini, etc.)
 * This is the future-ready parser that supports multiple AI providers
 */
export class UniversalCommandParser implements CommandParser {
  private aiProvider: AIProvider;
  private config: AIConfig;
  private isReady: boolean = false;

  // Smart parsing pipeline components
  private inputPreprocessor: InputPreprocessor;
  private formatDetector: FormatDetector;
  private contextEnhancer: ContextEnhancer;
  private smartPromptBuilder: SmartPromptBuilder;

  constructor(aiProvider: AIProvider, config: AIConfig) {
    this.config = config;
    this.aiProvider = aiProvider;

    // Initialize smart parsing components
    this.inputPreprocessor = new DefaultInputPreprocessor();
    this.formatDetector = new FormatDetector();
    this.contextEnhancer = new DefaultContextEnhancer();
    this.smartPromptBuilder = new DefaultSmartPromptBuilder();
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
      // Use smart parsing pipeline
      const detailedResult = await this.parseCommandWithSmartPipeline(
        naturalLanguageInput
      );
      return detailedResult.spec;
    } catch (error) {
      console.error(
        `Error parsing command with smart pipeline (${this.aiProvider.getProviderName()}):`,
        error
      );
      return this.enhancedFallbackParsing(naturalLanguageInput);
    }
  }

  /**
   * Enhanced parsing method using the complete smart parsing pipeline
   */
  async parseCommandWithSmartPipeline(
    naturalLanguageInput: string
  ): Promise<DetailedParseResult> {
    const processingSteps: string[] = [];

    try {
      // Step 1: Input preprocessing
      processingSteps.push("Input preprocessing");
      const sanitizedInput =
        this.inputPreprocessor.sanitize(naturalLanguageInput);
      const structuredData =
        this.inputPreprocessor.extractStructuredData(sanitizedInput);

      // Step 2: Format detection
      processingSteps.push("Format detection");
      const formatResult = this.formatDetector.detectFormat(sanitizedInput);

      // Step 3: Context enhancement
      processingSteps.push("Context enhancement");
      let context = this.contextEnhancer.buildContext(
        sanitizedInput,
        structuredData,
        formatResult.hints
      );
      context = this.contextEnhancer.inferMissingFields(context);
      context = this.contextEnhancer.resolveAmbiguities(context);

      // Step 4: Smart prompt building
      processingSteps.push("Smart prompt building");
      const enhancedPrompt = this.smartPromptBuilder.buildPrompt(context);

      // Step 5: AI parsing with enhanced prompt
      processingSteps.push(`AI parsing (${this.aiProvider.getProviderName()})`);
      let spec: LoadTestSpec;
      let confidence: number;
      let warnings: string[] = [];
      let assumptions: any[] = [];

      if (this.isReady) {
        const smartResult = await this.parseWithSmartPrompt(
          enhancedPrompt,
          context
        );
        spec = smartResult.spec;
        confidence = smartResult.confidence;
        warnings = smartResult.warnings;
        assumptions = smartResult.assumptions;
      } else {
        console.warn(
          `${this.aiProvider.getProviderName()} not ready, using enhanced fallback parsing`
        );
        processingSteps.push("Fallback parsing (AI not ready)");
        spec = this.enhancedFallbackParsing(naturalLanguageInput);
        confidence = 0.4;
        warnings.push(
          `${this.aiProvider.getProviderName()} not available, used fallback parsing`
        );
      }

      // Step 6: Generate explanation
      processingSteps.push("Explanation generation");
      const explanation = this.generateParseExplanation(
        spec,
        context,
        enhancedPrompt
      );

      return {
        spec,
        confidence,
        ambiguities: context.ambiguities.map((a) => `${a.field}: ${a.reason}`),
        suggestions: enhancedPrompt.clarifications,
        explanation,
        warnings,
        assumptions,
        processingSteps,
      };
    } catch (error) {
      console.error(
        `Error in smart parsing pipeline (${this.aiProvider.getProviderName()}):`,
        error
      );
      processingSteps.push(`Error: ${(error as Error).message}`);

      // Fallback to basic parsing
      const fallbackSpec = this.enhancedFallbackParsing(naturalLanguageInput);
      return {
        spec: fallbackSpec,
        confidence: 0.2,
        ambiguities: ["Smart parsing pipeline failed"],
        suggestions: [
          "Try rephrasing your command",
          `Check ${this.aiProvider.getProviderName()} configuration`,
        ],
        explanation: {
          extractedComponents: [],
          assumptions: [],
          ambiguityResolutions: [],
          suggestions: ["Smart parsing failed, used basic fallback"],
        },
        warnings: [`Smart parsing failed: ${(error as Error).message}`],
        assumptions: [],
        processingSteps,
      };
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

  /**
   * Parse using smart prompt with enhanced AI capabilities
   */
  private async parseWithSmartPrompt(
    enhancedPrompt: EnhancedPrompt,
    context: ParseContext
  ): Promise<SmartParseResponse> {
    try {
      // Build the complete prompt with examples and clarifications
      const fullPrompt = this.buildFullPromptFromEnhanced(
        enhancedPrompt,
        context
      );

      // Call AI provider with enhanced prompt
      const response = await this.aiProvider.generateCompletion({
        prompt: fullPrompt,
        format: "json",
        temperature: 0.1,
        maxTokens: 1000,
      });

      // Parse and validate the response
      const parsedResponse = ResponseParser.parseOllamaResponse(
        response.response,
        context.originalInput
      );

      // Enhanced validation with context
      const validationResult = this.validateSpecWithContext(
        parsedResponse.spec,
        context.originalInput,
        parsedResponse.confidence,
        parsedResponse.ambiguities
      );

      if (!validationResult.canProceed) {
        throw new Error(
          `Validation failed: ${validationResult.errors.join(", ")}`
        );
      }

      return {
        spec: parsedResponse.spec,
        confidence: Math.max(parsedResponse.confidence, context.confidence),
        assumptions: this.extractAssumptions(parsedResponse.spec, context),
        warnings: this.generateWarnings(parsedResponse.spec, context),
        suggestions: parsedResponse.suggestions,
      };
    } catch (error) {
      throw new Error(
        `Smart prompt parsing failed: ${(error as Error).message}`
      );
    }
  }

  /**
   * Build full prompt from enhanced prompt components
   */
  private buildFullPromptFromEnhanced(
    enhancedPrompt: EnhancedPrompt,
    context: ParseContext
  ): string {
    let fullPrompt = enhancedPrompt.systemPrompt;

    // Add contextual examples if available
    if (enhancedPrompt.contextualExamples.length > 0) {
      fullPrompt += "\n\nExamples:\n";
      enhancedPrompt.contextualExamples.forEach((example, index) => {
        fullPrompt += `\nExample ${index + 1}:\nInput: ${
          example.input
        }\nOutput: ${JSON.stringify(example.output, null, 2)}\n`;
      });
    }

    // Add clarifications
    if (enhancedPrompt.clarifications.length > 0) {
      fullPrompt += "\n\nImportant clarifications:\n";
      enhancedPrompt.clarifications.forEach((clarification, index) => {
        fullPrompt += `${index + 1}. ${clarification}\n`;
      });
    }

    // Add parsing instructions
    if (enhancedPrompt.parsingInstructions.length > 0) {
      fullPrompt += "\n\nParsing instructions:\n";
      enhancedPrompt.parsingInstructions.forEach((instruction, index) => {
        fullPrompt += `${index + 1}. ${instruction}\n`;
      });
    }

    // Add the user input
    fullPrompt += `\n\nUser Input to Parse:\n${context.originalInput}`;

    // Add final instruction
    fullPrompt +=
      "\n\nRespond with valid JSON only. Do not include explanations or markdown formatting.";

    return fullPrompt;
  }

  /**
   * Extract assumptions made during parsing
   */
  private extractAssumptions(spec: LoadTestSpec, context: ParseContext): any[] {
    const assumptions: any[] = [];

    // Check for method assumptions
    if (
      spec.requests[0]?.method &&
      context.extractedComponents.methods.length === 0
    ) {
      assumptions.push({
        field: "method",
        assumedValue: spec.requests[0].method,
        reason: "No HTTP method specified in input",
        alternatives: ["GET", "POST", "PUT", "DELETE"],
      });
    }

    // Check for URL assumptions
    if (
      spec.requests[0]?.url &&
      context.extractedComponents.urls.length === 0
    ) {
      assumptions.push({
        field: "url",
        assumedValue: spec.requests[0].url,
        reason: "No URL specified in input",
        alternatives: ["http://localhost:8080", "https://api.example.com"],
      });
    }

    // Check for user count assumptions
    if (
      spec.loadPattern.virtualUsers &&
      context.extractedComponents.counts.length === 0
    ) {
      assumptions.push({
        field: "virtualUsers",
        assumedValue: spec.loadPattern.virtualUsers,
        reason: "No user count specified in input",
        alternatives: [1, 10, 50, 100],
      });
    }

    return assumptions;
  }

  /**
   * Generate warnings based on parsing results
   */
  private generateWarnings(
    spec: LoadTestSpec,
    context: ParseContext
  ): string[] {
    const warnings: string[] = [];

    // Warn about low confidence
    if (context.confidence < 0.5) {
      warnings.push(
        "Input had low confidence - please verify the generated test specification"
      );
    }

    // Warn about ambiguities
    if (context.ambiguities.length > 0) {
      warnings.push(
        `${context.ambiguities.length} ambiguities were resolved with defaults`
      );
    }

    // Warn about missing authentication
    if (
      spec.requests[0]?.url?.includes("api") &&
      !spec.requests[0]?.headers?.Authorization
    ) {
      warnings.push(
        "API endpoint detected but no authentication headers found"
      );
    }

    // Warn about high load without ramp-up
    if (
      spec.loadPattern.virtualUsers &&
      spec.loadPattern.virtualUsers > 100 &&
      spec.loadPattern.type === "constant"
    ) {
      warnings.push(
        "High user count with constant load - consider using ramp-up pattern"
      );
    }

    return warnings;
  }

  /**
   * Generate detailed parsing explanation
   */
  private generateParseExplanation(
    spec: LoadTestSpec,
    context: ParseContext,
    enhancedPrompt: EnhancedPrompt
  ): ParseExplanation {
    const extractedComponents: string[] = [];

    if (context.extractedComponents.methods.length > 0) {
      extractedComponents.push(`HTTP Method: ${spec.requests[0]?.method}`);
    }

    if (context.extractedComponents.urls.length > 0) {
      extractedComponents.push(`URL: ${spec.requests[0]?.url}`);
    }

    if (context.extractedComponents.counts.length > 0) {
      extractedComponents.push(`User Count: ${spec.loadPattern.virtualUsers}`);
    }

    const ambiguityResolutions = context.ambiguities.map(
      (ambiguity) => `${ambiguity.field}: ${ambiguity.reason}`
    );

    const assumptions = this.extractAssumptions(spec, context);

    return {
      extractedComponents,
      assumptions,
      ambiguityResolutions,
      suggestions: enhancedPrompt.clarifications,
    };
  }

  /**
   * Get detailed parsing feedback with explanations
   */
  async getDetailedParsingFeedback(
    naturalLanguageInput: string
  ): Promise<DetailedParseResult> {
    return this.parseCommandWithSmartPipeline(naturalLanguageInput);
  }

  /**
   * Get parsing pipeline status and capabilities
   */
  getSmartParsingStatus(): {
    isReady: boolean;
    providerName: string;
    components: {
      preprocessor: boolean;
      formatDetector: boolean;
      contextEnhancer: boolean;
      promptBuilder: boolean;
      aiProvider: boolean;
    };
    capabilities: string[];
  } {
    return {
      isReady: this.isReady,
      providerName: this.aiProvider.getProviderName(),
      components: {
        preprocessor: !!this.inputPreprocessor,
        formatDetector: !!this.formatDetector,
        contextEnhancer: !!this.contextEnhancer,
        promptBuilder: !!this.smartPromptBuilder,
        aiProvider: this.isReady,
      },
      capabilities: [
        "Input sanitization and structure extraction",
        "Format detection with confidence scoring",
        "Context enhancement and ambiguity resolution",
        "Dynamic prompt building with examples",
        "Enhanced AI parsing with fallback mechanisms",
        "Detailed parsing explanations and feedback",
        `Universal AI provider support (${this.aiProvider.getProviderName()})`,
      ],
    };
  }

  /**
   * Log parsing assumptions for transparency (Requirement 4.2)
   */
  logParsingAssumptions(assumptions: any[]): void {
    if (assumptions.length > 0) {
      console.log(
        `🔍 Parsing Assumptions Made (${this.aiProvider.getProviderName()}):`
      );
      assumptions.forEach((assumption, index) => {
        console.log(
          `  ${index + 1}. ${assumption.field}: ${assumption.assumedValue} (${
            assumption.reason
          })`
        );
        if (assumption.alternatives && assumption.alternatives.length > 0) {
          console.log(
            `     Alternatives: ${assumption.alternatives.join(", ")}`
          );
        }
      });
    }
  }

  /**
   * Get specific parsing error messages with suggestions (Requirement 4.3)
   */
  getParsingErrors(
    input: string,
    error: Error,
    context?: ParseContext
  ): {
    errorType: string;
    message: string;
    suggestions: string[];
    recoveryOptions: string[];
    providerSpecific: string[];
  } {
    const errorMessage = error.message.toLowerCase();
    let errorType = "unknown";
    let suggestions: string[] = [];
    let recoveryOptions: string[] = [];
    let providerSpecific: string[] = [];

    // Classify error types
    if (errorMessage.includes("url") || errorMessage.includes("endpoint")) {
      errorType = "missing_url";
      suggestions = [
        "Include a complete URL (e.g., https://api.example.com/endpoint)",
        "Ensure the URL is properly formatted",
        "Check if the URL is accessible",
      ];
      recoveryOptions = [
        "Try with a sample URL: https://httpbin.org/get",
        "Use a relative path if testing locally: /api/test",
      ];
    } else if (errorMessage.includes("method")) {
      errorType = "missing_method";
      suggestions = [
        "Specify the HTTP method (GET, POST, PUT, DELETE)",
        "Use common patterns like 'GET /api/users' or 'POST to /api/orders'",
      ];
      recoveryOptions = [
        "Default to GET method for read operations",
        "Use POST for data submission",
      ];
    } else if (
      errorMessage.includes("users") ||
      errorMessage.includes("load")
    ) {
      errorType = "missing_load_config";
      suggestions = [
        "Specify the number of virtual users (e.g., '50 users')",
        "Include load pattern (e.g., 'ramp up from 1 to 100 users')",
        "Add test duration (e.g., 'for 5 minutes')",
      ];
      recoveryOptions = [
        "Use default: 10 users for 30 seconds",
        "Start with light load: 5 users for 1 minute",
      ];
    } else if (
      errorMessage.includes("json") ||
      errorMessage.includes("format")
    ) {
      errorType = "format_error";
      suggestions = [
        "Check JSON syntax if providing structured data",
        "Separate natural language from structured data clearly",
        "Use proper quotes for JSON strings",
      ];
      recoveryOptions = [
        "Try rephrasing in natural language",
        "Provide data in key-value format",
      ];
    } else if (
      errorMessage.includes("ai") ||
      errorMessage.includes("model") ||
      errorMessage.includes("api")
    ) {
      errorType = "ai_service_error";
      suggestions = [
        `Check if ${this.aiProvider.getProviderName()} service is running`,
        "Verify API configuration and credentials",
        "Try again in a few moments",
      ];
      recoveryOptions = [
        "Use fallback parsing mode",
        "Provide more structured input",
      ];
      providerSpecific = this.getProviderSpecificSuggestions(
        this.aiProvider.getProviderName()
      );
    }

    // Add context-specific suggestions
    if (context) {
      if (context.confidence < 0.3) {
        suggestions.push("Try being more specific in your request");
        suggestions.push("Include more details about the API endpoint");
      }
      if (context.ambiguities.length > 0) {
        suggestions.push("Resolve ambiguities by being more explicit");
        context.ambiguities.forEach((ambiguity) => {
          suggestions.push(`Clarify: ${ambiguity.reason}`);
        });
      }
    }

    return {
      errorType,
      message: error.message,
      suggestions: [...new Set(suggestions)], // Remove duplicates
      recoveryOptions: [...new Set(recoveryOptions)], // Remove duplicates
      providerSpecific,
    };
  }

  /**
   * Get provider-specific suggestions
   */
  private getProviderSpecificSuggestions(providerName: string): string[] {
    const suggestions: string[] = [];

    switch (providerName.toLowerCase()) {
      case "openai":
        suggestions.push("Check OpenAI API key and quota");
        suggestions.push("Verify model availability (gpt-3.5-turbo, gpt-4)");
        break;
      case "claude":
        suggestions.push("Check Anthropic API key and usage limits");
        suggestions.push("Verify Claude model access");
        break;
      case "gemini":
        suggestions.push("Check Google AI API key");
        suggestions.push("Verify Gemini model availability");
        break;
      case "ollama":
        suggestions.push("Ensure Ollama service is running on localhost:11434");
        suggestions.push("Check if the model is pulled and available");
        break;
      default:
        suggestions.push(`Check ${providerName} service configuration`);
    }

    return suggestions;
  }

  /**
   * Get parsing warnings for uncertain areas (Requirement 4.4)
   */
  getParsingWarnings(
    spec: LoadTestSpec,
    context: ParseContext,
    confidence: number
  ): {
    uncertainAreas: string[];
    needsConfirmation: string[];
    recommendations: string[];
    providerNotes: string[];
  } {
    const uncertainAreas: string[] = [];
    const needsConfirmation: string[] = [];
    const recommendations: string[] = [];
    const providerNotes: string[] = [];

    // Check confidence level
    if (confidence < 0.5) {
      uncertainAreas.push("Overall parsing confidence is low");
      needsConfirmation.push("Please verify the generated test specification");
      providerNotes.push(
        `${this.aiProvider.getProviderName()} had difficulty parsing this input`
      );
    }

    // Check for ambiguities
    context.ambiguities.forEach((ambiguity) => {
      uncertainAreas.push(`${ambiguity.field}: ${ambiguity.reason}`);
      needsConfirmation.push(`Confirm ${ambiguity.field} setting`);
    });

    // Check for inferred fields
    if (context.inferredFields) {
      Object.entries(context.inferredFields).forEach(([field, value]) => {
        if (value) {
          uncertainAreas.push(`${field} was inferred as: ${value}`);
          needsConfirmation.push(`Verify ${field} is correct`);
        }
      });
    }

    // Check for missing authentication
    if (
      spec.requests[0]?.url?.includes("api") &&
      !spec.requests[0]?.headers?.Authorization &&
      !spec.requests[0]?.headers?.["X-API-Key"]
    ) {
      uncertainAreas.push(
        "No authentication headers detected for API endpoint"
      );
      needsConfirmation.push("Add authentication if required");
      recommendations.push("Consider adding API key or bearer token");
    }

    // Check for high load without ramp-up
    if (
      spec.loadPattern.virtualUsers &&
      spec.loadPattern.virtualUsers > 50 &&
      spec.loadPattern.type === "constant"
    ) {
      uncertainAreas.push("High constant load detected");
      needsConfirmation.push("Confirm load pattern is appropriate");
      recommendations.push("Consider using ramp-up pattern for high loads");
    }

    // Check for missing request body on POST/PUT
    if (
      ["POST", "PUT", "PATCH"].includes(spec.requests[0]?.method || "") &&
      !spec.requests[0]?.body
    ) {
      uncertainAreas.push(
        "No request body specified for data modification method"
      );
      needsConfirmation.push("Add request body if needed");
      recommendations.push("Include sample JSON data for testing");
    }

    // Add provider-specific notes
    providerNotes.push(`Parsed using ${this.aiProvider.getProviderName()}`);
    if (!this.isReady) {
      providerNotes.push(
        `${this.aiProvider.getProviderName()} was not ready, used fallback`
      );
    }

    return {
      uncertainAreas,
      needsConfirmation,
      recommendations,
      providerNotes,
    };
  }

  /**
   * Enhanced parsing with comprehensive feedback (combines all feedback methods)
   */
  async parseCommandWithComprehensiveFeedback(
    naturalLanguageInput: string
  ): Promise<
    DetailedParseResult & {
      loggedAssumptions: boolean;
      errorAnalysis?: {
        errorType: string;
        message: string;
        suggestions: string[];
        recoveryOptions: string[];
        providerSpecific: string[];
      };
      warningAnalysis: {
        uncertainAreas: string[];
        needsConfirmation: string[];
        recommendations: string[];
        providerNotes: string[];
      };
    }
  > {
    try {
      const result = await this.parseCommandWithSmartPipeline(
        naturalLanguageInput
      );

      // Log assumptions for transparency (Requirement 4.2)
      this.logParsingAssumptions(result.assumptions);

      // Get warning analysis (Requirement 4.4)
      const warningAnalysis = this.getParsingWarnings(
        result.spec,
        {
          originalInput: naturalLanguageInput,
          cleanedInput: naturalLanguageInput,
          extractedComponents: {
            methods: [],
            urls: [],
            headers: [],
            bodies: [],
            counts: [],
            jsonBlocks: [],
          },
          inferredFields: {
            testType: result.spec.testType,
            duration: result.spec.duration?.value?.toString() || "",
            loadPattern: result.spec.loadPattern.type,
          },
          ambiguities: result.ambiguities.map((a) => ({
            field: a.split(":")[0],
            possibleValues: [],
            reason: a.split(":")[1] || a,
          })),
          confidence: result.confidence,
        },
        result.confidence
      );

      return {
        ...result,
        loggedAssumptions: result.assumptions.length > 0,
        warningAnalysis,
      };
    } catch (error) {
      // Get error analysis (Requirement 4.3)
      const errorAnalysis = this.getParsingErrors(
        naturalLanguageInput,
        error as Error
      );

      // Fallback parsing
      const fallbackSpec = this.enhancedFallbackParsing(naturalLanguageInput);

      return {
        spec: fallbackSpec,
        confidence: 0.2,
        ambiguities: ["Parsing failed, used fallback"],
        suggestions: errorAnalysis.suggestions,
        explanation: {
          extractedComponents: [],
          assumptions: [],
          ambiguityResolutions: [],
          suggestions: errorAnalysis.suggestions,
        },
        warnings: [errorAnalysis.message],
        assumptions: [],
        processingSteps: ["Error occurred", "Fallback parsing"],
        loggedAssumptions: false,
        errorAnalysis,
        warningAnalysis: {
          uncertainAreas: ["Parsing failed"],
          needsConfirmation: ["Verify fallback result"],
          recommendations: errorAnalysis.recoveryOptions,
          providerNotes: [
            `${this.aiProvider.getProviderName()} failed to parse`,
          ],
        },
      };
    }
  }
}
