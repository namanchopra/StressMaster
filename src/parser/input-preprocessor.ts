/**
 * Input preprocessing components for smart AI parser
 * Handles sanitization and structure extraction from messy input
 */

export interface StructuredData {
  jsonBlocks: string[];
  urls: string[];
  headers: Record<string, string>;
  methods: string[];
  keyValuePairs: Record<string, string>;
}

export interface InputPreprocessor {
  sanitize(input: string): string;
  extractStructuredData(input: string): StructuredData;
  normalizeWhitespace(input: string): string;
  separateRequests(input: string): string[];
}

export class DefaultInputPreprocessor implements InputPreprocessor {
  private readonly HTTP_METHODS = [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "HEAD",
    "OPTIONS",
  ];
  private readonly URL_PATTERN = /https?:\/\/[^\s]+|\/[^\s]*/g;
  private readonly JSON_PATTERN = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  private readonly HEADER_PATTERNS = [
    /^[ \t]*([A-Za-z][A-Za-z0-9-]*):[ \t]*([^\r\n\\]+)$/gm, // Standard header format (line start)
    /['"]([A-Za-z-]+)['"]\s*:\s*['"]([^'"\\]+)['"]/g, // Quoted header format
    /-H\s+['"]([A-Za-z-]+):\s*([^'"\\]+)['"]/g, // Curl -H format
  ];

  sanitize(input: string): string {
    if (!input || typeof input !== "string") {
      return "";
    }

    // Remove null bytes and control characters except newlines and tabs
    let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");

    // Normalize line endings
    sanitized = sanitized.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Remove excessive spaces but preserve tabs and structure
    sanitized = sanitized.replace(/ +/g, " ");

    // Remove leading/trailing whitespace from each line
    sanitized = sanitized
      .split("\n")
      .map((line) => line.trim())
      .join("\n");

    // Remove excessive empty lines (more than 2 consecutive)
    sanitized = sanitized.replace(/\n{3,}/g, "\n\n");

    return sanitized.trim();
  }

  normalizeWhitespace(input: string): string {
    if (!input || typeof input !== "string") {
      return "";
    }

    return input
      .replace(/[ \t]+/g, " ") // Replace multiple spaces/tabs with single space
      .replace(/\s*\n\s*/g, "\n") // Clean up line breaks
      .trim();
  }

  extractStructuredData(input: string): StructuredData {
    const sanitizedInput = this.sanitize(input);

    return {
      jsonBlocks: this.extractJsonBlocks(sanitizedInput),
      urls: this.extractUrls(sanitizedInput),
      headers: this.extractHeaders(sanitizedInput),
      methods: this.extractHttpMethods(sanitizedInput),
      keyValuePairs: this.extractKeyValuePairs(sanitizedInput),
    };
  }

  separateRequests(input: string): string[] {
    const sanitizedInput = this.sanitize(input);

    // Split by common request separators
    const separators = [
      /\n\s*---+\s*\n/g, // Markdown-style separators
      /\n\s*===+\s*\n/g, // Alternative separators
      /\n\s*Request\s*\d*\s*:?\s*\n/gi, // "Request 1:", "Request:", etc.
      /\n\s*\d+\.\s*\n/g, // Numbered lists "1.", "2.", etc.
    ];

    let requests = [sanitizedInput];

    for (const separator of separators) {
      const newRequests: string[] = [];
      for (const request of requests) {
        newRequests.push(...request.split(separator));
      }
      requests = newRequests;
    }

    // Filter out empty requests and trim
    return requests.map((req) => req.trim()).filter((req) => req.length > 0);
  }

  private extractJsonBlocks(input: string): string[] {
    const matches = input.match(this.JSON_PATTERN) || [];
    const validJsonBlocks: string[] = [];

    for (const match of matches) {
      try {
        const parsed = JSON.parse(match);
        // Preserve the complete JSON structure, don't extract nested parts
        validJsonBlocks.push(match);
      } catch {
        // Try to fix common JSON issues
        const fixed = this.attemptJsonFix(match);
        if (fixed) {
          validJsonBlocks.push(fixed);
        }
      }
    }

    return validJsonBlocks;
  }

  private attemptJsonFix(jsonString: string): string | null {
    try {
      // Common fixes for malformed JSON
      let fixed = jsonString
        .replace(/'/g, '"') // Replace single quotes with double quotes
        .replace(/([{,]\s*)(\w+):/g, '$1"$2":') // Quote unquoted keys
        .replace(/:\s*([^",\[\]{}]+)([,}])/g, ':"$1"$2'); // Quote unquoted string values

      JSON.parse(fixed);
      return fixed;
    } catch {
      return null;
    }
  }

  private extractUrls(input: string): string[] {
    const matches = input.match(this.URL_PATTERN) || [];
    return Array.from(new Set(matches)); // Remove duplicates
  }

  private extractHeaders(input: string): Record<string, string> {
    const headers: Record<string, string> = {};

    for (const pattern of this.HEADER_PATTERNS) {
      let match;
      while ((match = pattern.exec(input)) !== null) {
        const [, key, value] = match;
        if (key && value) {
          // Normalize header key to lowercase with proper casing
          const normalizedKey = key
            .toLowerCase()
            .split("-")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join("-");
          // Clean up value by removing trailing backslashes and quotes
          const cleanValue = value
            .trim()
            .replace(/['"\\]+$/, "")
            .replace(/^['"]/, "");
          headers[normalizedKey] = cleanValue;
        }
      }
    }

    return headers;
  }

  private extractHttpMethods(input: string): string[] {
    const methods: string[] = [];
    const upperInput = input.toUpperCase();

    for (const method of this.HTTP_METHODS) {
      const regex = new RegExp(`\\b${method}\\b`, "g");
      if (regex.test(upperInput)) {
        methods.push(method);
      }
    }

    return Array.from(new Set(methods)); // Remove duplicates
  }

  private extractKeyValuePairs(input: string): Record<string, string> {
    const pairs: Record<string, string> = {};

    // Pattern for key-value pairs like "key: value" or "key = value"
    const kvPattern = /(\w+)\s*[:=]\s*([^\n\r,;]+)/g;
    let match;

    while ((match = kvPattern.exec(input)) !== null) {
      const [, key, value] = match;
      if (key && value) {
        pairs[key.trim()] = value.trim();
      }
    }

    return pairs;
  }
}
