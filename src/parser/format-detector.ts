/**
 * Format detection system for identifying input patterns and providing parsing hints
 */

export type InputFormat =
  | "natural_language"
  | "mixed_structured"
  | "curl_command"
  | "http_raw"
  | "json_with_text"
  | "concatenated_requests";

export interface ParsingHint {
  type: "method" | "url" | "headers" | "body" | "count";
  value: string;
  confidence: number;
  position: { start: number; end: number };
}

export interface FormatDetectionResult {
  format: InputFormat;
  confidence: number;
  hints: ParsingHint[];
}

export class FormatDetector {
  private readonly patterns = {
    curl: /curl\s+(-[A-Za-z]\s+[^\s]+\s+)*['"]?https?:\/\/[^\s'"]+['"]?/gi,
    httpMethod: /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/gi,
    url: /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi,
    json: /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g,
    headers: /^\s*[\w-]+:\s*[^\r\n]+$/gm,
    userCount: /\b(\d+)\s*(users?|concurrent|parallel|threads?)\b/gi,
    duration: /\b(\d+)\s*(seconds?|minutes?|hours?|s|m|h)\b/gi,
    rps: /\b(\d+)\s*(rps|requests?\s*per\s*second|req\/s)\b/gi,
  };

  /**
   * Detects the format of the input and returns confidence score with hints
   */
  detectFormat(input: string): FormatDetectionResult {
    const hints: ParsingHint[] = [];
    const formatScores: Record<InputFormat, number> = {
      natural_language: 0.1, // Base score for natural language
      mixed_structured: 0,
      curl_command: 0,
      http_raw: 0,
      json_with_text: 0,
      concatenated_requests: 0,
    };

    // Extract parsing hints and calculate format scores
    this.extractHints(input, hints);
    this.calculateFormatScores(input, hints, formatScores);

    // Determine the most likely format
    const format = this.selectBestFormat(formatScores);
    const confidence = Math.min(formatScores[format], 1.0);

    return {
      format,
      confidence,
      hints,
    };
  }

  private extractHints(input: string, hints: ParsingHint[]): void {
    // Reset all regex lastIndex
    Object.values(this.patterns).forEach((pattern) => {
      if (pattern.global) pattern.lastIndex = 0;
    });

    // Extract HTTP methods
    let match;
    while ((match = this.patterns.httpMethod.exec(input)) !== null) {
      hints.push({
        type: "method",
        value: match[0].toUpperCase(),
        confidence: 0.9,
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Extract URLs
    this.patterns.url.lastIndex = 0;
    while ((match = this.patterns.url.exec(input)) !== null) {
      hints.push({
        type: "url",
        value: match[0],
        confidence: 0.95,
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Extract headers (only lines that look like headers)
    this.patterns.headers.lastIndex = 0;
    while ((match = this.patterns.headers.exec(input)) !== null) {
      hints.push({
        type: "headers",
        value: match[0].trim(),
        confidence: 0.8,
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Extract JSON bodies with better validation
    this.patterns.json.lastIndex = 0;
    while ((match = this.patterns.json.exec(input)) !== null) {
      try {
        JSON.parse(match[0]);
        hints.push({
          type: "body",
          value: match[0],
          confidence: 0.9,
          position: { start: match.index, end: match.index + match[0].length },
        });
      } catch {
        // Check if it looks like JSON but has syntax errors
        if (
          match[0].includes('"') &&
          (match[0].includes(":") || match[0].includes(","))
        ) {
          hints.push({
            type: "body",
            value: match[0],
            confidence: 0.5,
            position: {
              start: match.index,
              end: match.index + match[0].length,
            },
          });
        }
      }
    }

    // Extract user counts
    this.patterns.userCount.lastIndex = 0;
    while ((match = this.patterns.userCount.exec(input)) !== null) {
      hints.push({
        type: "count",
        value: match[1],
        confidence: 0.8,
        position: { start: match.index, end: match.index + match[0].length },
      });
    }
  }

  private calculateFormatScores(
    input: string,
    hints: ParsingHint[],
    scores: Record<InputFormat, number>
  ): void {
    const lowerInput = input.toLowerCase();

    // Check for curl command - highest priority
    this.patterns.curl.lastIndex = 0;
    if (this.patterns.curl.test(input)) {
      scores.curl_command = 0.95;
      return; // Curl is very distinctive, return early
    }

    // Check for HTTP raw format
    const httpRawIndicators = [
      /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\/\S*\s+HTTP\/\d\.\d/m,
      /^Host:\s*[^\r\n]+/m,
      /^User-Agent:\s*[^\r\n]+/m,
    ];

    let httpRawMatches = 0;
    httpRawIndicators.forEach((pattern) => {
      if (pattern.test(input)) {
        httpRawMatches++;
      }
    });

    if (httpRawMatches >= 2) {
      scores.http_raw = 0.9;
      return; // HTTP raw is also very distinctive
    } else if (httpRawMatches === 1) {
      scores.http_raw = 0.6;
    }

    // Check for concatenated requests - multiple methods or URLs
    const methodCount = hints.filter((h) => h.type === "method").length;
    const urlCount = hints.filter((h) => h.type === "url").length;
    if (methodCount > 1 || urlCount > 1) {
      scores.concatenated_requests = 0.8;
    }

    // Check for JSON with text
    const jsonBlocks = hints.filter((h) => h.type === "body").length;
    const textWithoutJson = input
      .replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, "")
      .trim();
    if (jsonBlocks > 0 && textWithoutJson.length > 20) {
      scores.json_with_text = 0.7;
    }

    // Check for mixed structured data
    const hasUrls = hints.some((h) => h.type === "url");
    const hasHeaders = hints.some((h) => h.type === "headers");
    const hasMethods = hints.some((h) => h.type === "method");
    const hasNaturalLanguage =
      /\b(test|load|performance|users?|requests?|endpoint|please|create|need|want)\b/i.test(
        input
      );

    if ((hasUrls || hasHeaders || hasMethods) && hasNaturalLanguage) {
      scores.mixed_structured = 0.6;
    }

    // Natural language scoring
    const naturalLanguageIndicators = [
      "please",
      "can you",
      "i want",
      "i need",
      "create a test",
      "load test",
      "performance test",
      "test with",
      "simulate",
    ];

    let naturalLanguageScore = 0.1; // Base score
    naturalLanguageIndicators.forEach((indicator) => {
      if (lowerInput.includes(indicator)) {
        naturalLanguageScore += 0.15;
      }
    });

    // Boost natural language if no structured data found
    if (hints.length === 0) {
      naturalLanguageScore += 0.4;
    }

    scores.natural_language = Math.min(naturalLanguageScore, 0.9);

    // Apply complexity multiplier
    const complexity = this.calculateComplexity(input, hints);
    Object.keys(scores).forEach((format) => {
      if (scores[format as InputFormat] > 0) {
        scores[format as InputFormat] = Math.min(
          scores[format as InputFormat] * complexity,
          1.0
        );
      }
    });
  }

  private calculateComplexity(input: string, hints: ParsingHint[]): number {
    const baseComplexity = 0.7;
    const hintBonus = Math.min(hints.length * 0.05, 0.2);
    const lengthBonus = Math.min(input.length / 2000, 0.1);

    return Math.min(baseComplexity + hintBonus + lengthBonus, 1.0);
  }

  private selectBestFormat(scores: Record<InputFormat, number>): InputFormat {
    let bestFormat: InputFormat = "natural_language";
    let bestScore = scores.natural_language;

    Object.entries(scores).forEach(([format, score]) => {
      if (score > bestScore) {
        bestFormat = format as InputFormat;
        bestScore = score;
      }
    });

    return bestFormat;
  }

  /**
   * Get confidence score for the detected format
   */
  getConfidence(result: FormatDetectionResult): number {
    return result.confidence;
  }

  /**
   * Get parsing hints for the detected format
   */
  getParsingHints(result: FormatDetectionResult): ParsingHint[] {
    return result.hints;
  }
}
