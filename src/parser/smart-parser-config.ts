/**
 * Configuration interface for the Smart AI Parser system
 */
export interface SmartParserConfig {
  preprocessing: {
    enableSanitization: boolean;
    enableStructureExtraction: boolean;
    maxInputLength: number;
    normalizeWhitespace: boolean;
    separateRequests: boolean;
  };
  formatDetection: {
    confidenceThreshold: number;
    enableMultiFormatDetection: boolean;
    enablePatternMatching: boolean;
  };
  contextEnhancement: {
    enableInference: boolean;
    enableAmbiguityResolution: boolean;
    maxAmbiguities: number;
    inferenceConfidenceThreshold: number;
  };
  aiProvider: {
    maxRetries: number;
    temperature: number;
    enableValidationRetries: boolean;
    timeoutMs: number;
  };
  fallback: {
    enableSmartFallback: boolean;
    fallbackConfidenceThreshold: number;
    maxFallbackAttempts: number;
  };
  monitoring: {
    enableMetrics: boolean;
    enableDiagnostics: boolean;
    logLevel: "debug" | "info" | "warn" | "error";
    metricsRetentionMs: number;
  };
}

/**
 * Default configuration for the Smart AI Parser
 */
export const DEFAULT_SMART_PARSER_CONFIG: SmartParserConfig = {
  preprocessing: {
    enableSanitization: true,
    enableStructureExtraction: true,
    maxInputLength: 10000,
    normalizeWhitespace: true,
    separateRequests: true,
  },
  formatDetection: {
    confidenceThreshold: 0.7,
    enableMultiFormatDetection: true,
    enablePatternMatching: true,
  },
  contextEnhancement: {
    enableInference: true,
    enableAmbiguityResolution: true,
    maxAmbiguities: 5,
    inferenceConfidenceThreshold: 0.6,
  },
  aiProvider: {
    maxRetries: 3,
    temperature: 0.1,
    enableValidationRetries: true,
    timeoutMs: 30000,
  },
  fallback: {
    enableSmartFallback: true,
    fallbackConfidenceThreshold: 0.5,
    maxFallbackAttempts: 2,
  },
  monitoring: {
    enableMetrics: true,
    enableDiagnostics: false,
    logLevel: "info",
    metricsRetentionMs: 24 * 60 * 60 * 1000, // 24 hours
  },
};

/**
 * Configuration manager for Smart AI Parser
 */
export class SmartParserConfigManager {
  private config: SmartParserConfig;

  constructor(config?: Partial<SmartParserConfig>) {
    this.config = this.mergeConfig(DEFAULT_SMART_PARSER_CONFIG, config || {});
  }

  /**
   * Get the current configuration
   */
  getConfig(): SmartParserConfig {
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * Update configuration with partial config
   */
  updateConfig(partialConfig: Partial<SmartParserConfig>): void {
    this.config = this.mergeConfig(this.config, partialConfig);
  }

  /**
   * Reset configuration to defaults
   */
  resetToDefaults(): void {
    this.config = { ...DEFAULT_SMART_PARSER_CONFIG };
  }

  /**
   * Validate configuration values
   */
  validateConfig(config: SmartParserConfig): string[] {
    const errors: string[] = [];

    if (config.preprocessing.maxInputLength <= 0) {
      errors.push("preprocessing.maxInputLength must be greater than 0");
    }

    if (
      config.formatDetection.confidenceThreshold < 0 ||
      config.formatDetection.confidenceThreshold > 1
    ) {
      errors.push(
        "formatDetection.confidenceThreshold must be between 0 and 1"
      );
    }

    if (config.contextEnhancement.maxAmbiguities < 0) {
      errors.push("contextEnhancement.maxAmbiguities must be non-negative");
    }

    if (config.aiProvider.maxRetries < 0) {
      errors.push("aiProvider.maxRetries must be non-negative");
    }

    if (
      config.aiProvider.temperature < 0 ||
      config.aiProvider.temperature > 2
    ) {
      errors.push("aiProvider.temperature must be between 0 and 2");
    }

    if (config.aiProvider.timeoutMs <= 0) {
      errors.push("aiProvider.timeoutMs must be greater than 0");
    }

    if (
      config.fallback.fallbackConfidenceThreshold < 0 ||
      config.fallback.fallbackConfidenceThreshold > 1
    ) {
      errors.push(
        "fallback.fallbackConfidenceThreshold must be between 0 and 1"
      );
    }

    if (config.monitoring.metricsRetentionMs <= 0) {
      errors.push("monitoring.metricsRetentionMs must be greater than 0");
    }

    return errors;
  }

  private mergeConfig(
    base: SmartParserConfig,
    override: Partial<SmartParserConfig>
  ): SmartParserConfig {
    return {
      preprocessing: { ...base.preprocessing, ...override.preprocessing },
      formatDetection: { ...base.formatDetection, ...override.formatDetection },
      contextEnhancement: {
        ...base.contextEnhancement,
        ...override.contextEnhancement,
      },
      aiProvider: { ...base.aiProvider, ...override.aiProvider },
      fallback: { ...base.fallback, ...override.fallback },
      monitoring: { ...base.monitoring, ...override.monitoring },
    };
  }
}
