/**
 * Enhanced error recovery system for smart AI parsing
 * Provides multi-level error recovery with intelligent fallback mechanisms
 */

import { LoadTestSpec } from "../types";

/**
 * Classification of parsing errors by level and type
 */
export interface ParseError {
  level: "input" | "ai" | "validation" | "fallback";
  type: string;
  message: string;
  suggestions: string[];
  recoveryStrategy: RecoveryStrategy;
  originalError?: Error;
  context?: Record<string, any>;
}

/**
 * Strategy for recovering from parsing errors
 */
export interface RecoveryStrategy {
  canRecover: boolean;
  strategy: "retry" | "enhance_prompt" | "fallback" | "user_input";
  confidence: number;
  estimatedSuccess: number;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Result of error recovery attempt
 */
export interface RecoveryResult {
  success: boolean;
  result?: LoadTestSpec;
  error?: ParseError;
  attemptsUsed: number;
  recoveryPath: string[];
  confidence: number;
}

/**
 * Configuration for error recovery behavior
 */
export interface ErrorRecoveryConfig {
  maxRetries: number;
  retryDelay: number;
  confidenceThreshold: number;
  enableFallback: boolean;
  fallbackConfidenceThreshold: number;
  enablePromptEnhancement: boolean;
  enableUserInput: boolean;
}

/**
 * Context information for error recovery
 */
export interface RecoveryContext {
  originalInput: string;
  previousAttempts: ParseError[];
  availableStrategies: RecoveryStrategy[];
  userPreferences?: Record<string, any>;
  timeoutMs?: number;
}

/**
 * Enhanced error recovery system
 */
export class ErrorRecoverySystem {
  private config: ErrorRecoveryConfig;
  private recoveryAttempts: Map<string, number> = new Map();

  constructor(config: Partial<ErrorRecoveryConfig> = {}) {
    this.config = {
      maxRetries: 3,
      retryDelay: 1000,
      confidenceThreshold: 0.7,
      enableFallback: true,
      fallbackConfidenceThreshold: 0.5,
      enablePromptEnhancement: true,
      enableUserInput: false,
      ...config,
    };
  }

  /**
   * Classify an error and determine recovery strategy
   */
  classifyError(
    error: Error,
    level: ParseError["level"],
    context?: Record<string, any>
  ): ParseError {
    const errorType = this.determineErrorType(error, level);
    const recoveryStrategy = this.determineRecoveryStrategy(
      errorType,
      level,
      context
    );

    return {
      level,
      type: errorType,
      message: error.message,
      suggestions: this.generateSuggestions(errorType, level),
      recoveryStrategy,
      originalError: error,
      context,
    };
  }

  /**
   * Attempt to recover from a parsing error
   */
  async recover(
    parseError: ParseError,
    recoveryContext: RecoveryContext,
    recoveryFunction: (
      strategy: RecoveryStrategy,
      context: RecoveryContext
    ) => Promise<LoadTestSpec>
  ): Promise<RecoveryResult> {
    const recoveryKey = this.getRecoveryKey(parseError, recoveryContext);
    const currentAttempts = this.recoveryAttempts.get(recoveryKey) || 0;

    if (currentAttempts >= this.config.maxRetries) {
      return {
        success: false,
        error: parseError,
        attemptsUsed: currentAttempts,
        recoveryPath: ["max_retries_exceeded"],
        confidence: 0,
      };
    }

    const recoveryPath: string[] = [];
    let lastError = parseError;

    // Try recovery strategies in order of confidence
    const availableStrategies =
      recoveryContext.availableStrategies &&
      recoveryContext.availableStrategies.length > 0
        ? recoveryContext.availableStrategies
        : [parseError.recoveryStrategy];
    const strategies = this.sortStrategiesByConfidence(availableStrategies);

    for (const strategy of strategies) {
      if (!strategy.canRecover) continue;

      const attemptNumber = currentAttempts + recoveryPath.length + 1;

      try {
        recoveryPath.push(strategy.strategy);
        this.recoveryAttempts.set(recoveryKey, attemptNumber);

        // Add delay for retry strategies
        if (strategy.strategy === "retry" && strategy.retryDelay) {
          await this.delay(strategy.retryDelay);
        }

        const result = await recoveryFunction(strategy, recoveryContext);

        // Success - clear recovery attempts
        this.recoveryAttempts.delete(recoveryKey);

        return {
          success: true,
          result,
          attemptsUsed: attemptNumber,
          recoveryPath,
          confidence: strategy.confidence,
        };
      } catch (error) {
        lastError = this.classifyError(
          error instanceof Error ? error : new Error(String(error)),
          parseError.level,
          recoveryContext
        );

        // If this strategy failed, try the next one
        continue;
      }
    }

    // All strategies failed - keep the attempt count
    const finalAttempts = currentAttempts + recoveryPath.length;
    this.recoveryAttempts.set(recoveryKey, finalAttempts);

    return {
      success: false,
      error: lastError,
      attemptsUsed: finalAttempts,
      recoveryPath,
      confidence: 0,
    };
  }

  /**
   * Create a fallback recovery strategy with high confidence
   */
  createFallbackStrategy(confidence: number = 0.8): RecoveryStrategy {
    return {
      canRecover: this.config.enableFallback,
      strategy: "fallback",
      confidence,
      estimatedSuccess: confidence,
      maxRetries: 1,
    };
  }

  /**
   * Create a retry strategy with exponential backoff
   */
  createRetryStrategy(
    baseConfidence: number = 0.6,
    attempt: number = 1
  ): RecoveryStrategy {
    const confidence = Math.max(0.1, baseConfidence - attempt * 0.1);
    const retryDelay = Math.min(
      5000,
      this.config.retryDelay * Math.pow(2, attempt - 1)
    );

    return {
      canRecover: attempt <= this.config.maxRetries,
      strategy: "retry",
      confidence,
      estimatedSuccess: confidence,
      maxRetries: this.config.maxRetries,
      retryDelay,
    };
  }

  /**
   * Create a prompt enhancement strategy
   */
  createPromptEnhancementStrategy(confidence: number = 0.7): RecoveryStrategy {
    return {
      canRecover: this.config.enablePromptEnhancement,
      strategy: "enhance_prompt",
      confidence,
      estimatedSuccess: confidence,
      maxRetries: 2,
    };
  }

  private determineErrorType(error: Error, level: ParseError["level"]): string {
    const message = error.message.toLowerCase();

    switch (level) {
      case "input":
        if (message.includes("invalid format")) return "invalid_format";
        if (message.includes("missing")) return "missing_data";
        if (message.includes("malformed")) return "malformed_input";
        return "input_processing_error";

      case "ai":
        if (message.includes("timeout")) return "ai_timeout";
        if (message.includes("rate limit")) return "rate_limit";
        if (message.includes("invalid response")) return "invalid_ai_response";
        if (message.includes("network")) return "network_error";
        return "ai_processing_error";

      case "validation":
        if (message.includes("schema")) return "schema_validation_error";
        if (message.includes("required field")) return "missing_required_field";
        if (message.includes("invalid value")) return "invalid_field_value";
        return "validation_error";

      case "fallback":
        return "fallback_error";

      default:
        return "unknown_error";
    }
  }

  private determineRecoveryStrategy(
    errorType: string,
    level: ParseError["level"],
    context?: Record<string, any>
  ): RecoveryStrategy {
    // High confidence strategies for specific error types
    switch (errorType) {
      case "rate_limit":
        return {
          canRecover: true,
          strategy: "retry",
          confidence: 0.9,
          estimatedSuccess: 0.9,
          maxRetries: this.config.maxRetries,
          retryDelay: this.config.retryDelay * 2, // Longer delay for rate limits
        };

      case "network_error":
      case "ai_timeout":
        return this.createRetryStrategy(0.8, 1);

      case "invalid_ai_response":
        return this.createPromptEnhancementStrategy(0.7);

      case "malformed_input":
      case "invalid_format":
        return this.createFallbackStrategy(0.8);

      case "missing_data":
        return this.createPromptEnhancementStrategy(0.6);

      default:
        // Default strategy based on level
        switch (level) {
          case "input":
            return this.createFallbackStrategy(0.6);
          case "ai":
            return this.createRetryStrategy(0.5, 1);
          case "validation":
            return this.createPromptEnhancementStrategy(0.5);
          case "fallback":
            return {
              canRecover: false,
              strategy: "user_input",
              confidence: 0,
              estimatedSuccess: 0,
            };
          default:
            return this.createRetryStrategy(0.3, 1);
        }
    }
  }

  private generateSuggestions(
    errorType: string,
    level: ParseError["level"]
  ): string[] {
    const suggestions: string[] = [];

    switch (errorType) {
      case "invalid_format":
        suggestions.push("Try providing input in a more structured format");
        suggestions.push("Include clear HTTP method and URL");
        break;

      case "missing_data":
        suggestions.push("Provide complete request information");
        suggestions.push("Include required fields like URL and method");
        break;

      case "rate_limit":
        suggestions.push("Wait a moment before retrying");
        suggestions.push("Consider using a different AI provider");
        break;

      case "network_error":
        suggestions.push("Check your internet connection");
        suggestions.push("Verify AI provider configuration");
        break;

      case "invalid_ai_response":
        suggestions.push(
          "The AI response was malformed - retrying with enhanced prompt"
        );
        break;

      default:
        suggestions.push("Review input format and try again");
        suggestions.push("Check system logs for more details");
    }

    return suggestions;
  }

  private sortStrategiesByConfidence(
    strategies: RecoveryStrategy[]
  ): RecoveryStrategy[] {
    return strategies
      .filter((s) => s.canRecover)
      .sort((a, b) => b.confidence - a.confidence);
  }

  private getRecoveryKey(
    parseError: ParseError,
    context: RecoveryContext
  ): string {
    return `${parseError.level}:${
      parseError.type
    }:${context.originalInput.slice(0, 50)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Reset recovery attempts for a specific context
   */
  resetRecoveryAttempts(recoveryKey?: string): void {
    if (recoveryKey) {
      this.recoveryAttempts.delete(recoveryKey);
    } else {
      this.recoveryAttempts.clear();
    }
  }

  /**
   * Get current recovery statistics
   */
  getRecoveryStats(): { totalAttempts: number; activeRecoveries: number } {
    const totalAttempts = Array.from(this.recoveryAttempts.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    return {
      totalAttempts,
      activeRecoveries: this.recoveryAttempts.size,
    };
  }
}
