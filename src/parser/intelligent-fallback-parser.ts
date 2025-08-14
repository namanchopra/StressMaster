/**
 * Intelligent fallback parser for when AI parsing fails
 * Uses rule-based parsing with high confidence for common patterns
 */

import { LoadTestSpec, RequestSpec } from "../types";

export interface FallbackParseResult {
  spec: LoadTestSpec;
  confidence: number;
  warnings: string[];
  assumptions: string[];
}

export interface FallbackParsingRules {
  urlPatterns: RegExp[];
  methodPatterns: RegExp[];
  headerPatterns: RegExp[];
  bodyPatterns: RegExp[];
  loadPatterns: RegExp[];
}

/**
 * Intelligent fallback parser that uses rule-based parsing
 * when AI parsing fails or produces low-confidence results
 */
export class IntelligentFallbackParser {
  private rules: FallbackParsingRules;

  constructor() {
    this.rules = {
      urlPatterns: [
        /https?:\/\/[^\s,;]+/gi,
        /(?:url|endpoint|host):\s*([^\s,;]+)/gi,
      ],
      methodPatterns: [
        /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b(?=\s|$)/gi,
        /method:\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/gi,
      ],
      headerPatterns: [
        /^\s*([a-zA-Z-]+):\s*([^\r\n,]+)\s*$/gm,
        /"([^"]+)":\s*"([^"]+)"/g,
        /header\s+([a-zA-Z-]+)\s*[:=]\s*([^\r\n,]+)/gi,
      ],
      bodyPatterns: [
        /\{[\s\S]*\}/g,
        /body:\s*(\{[\s\S]*?\})/gi,
        /data:\s*(\{[\s\S]*?\})/gi,
      ],
      loadPatterns: [
        /(\d+)\s*(?:users?|concurrent|parallel)/gi,
        /(?:for|duration)[\s:]*(\d+[smh]?)/gi,
        /rate:\s*(\d+)/gi,
        /ramp[- ]?up:\s*(\d+[smh]?)/gi,
      ],
    };
  }

  /**
   * Parse input using rule-based fallback approach
   */
  parse(input: string): FallbackParseResult {
    const warnings: string[] = [];
    const assumptions: string[] = [];
    let confidence = 0.6; // Start with moderate confidence for fallback

    // Extract basic components
    const urls = this.extractUrls(input);
    const methods = this.extractMethods(input);
    const headers = this.extractHeaders(input);
    const bodies = this.extractBodies(input);
    const loadConfig = this.extractLoadConfiguration(input);

    // Validate minimum requirements
    if (urls.length === 0) {
      warnings.push("No valid URLs found in input");
      confidence -= 0.3;

      // Try to infer a URL from context
      const inferredUrl = this.inferUrl(input);
      if (inferredUrl) {
        urls.push(inferredUrl);
        assumptions.push(`Inferred URL: ${inferredUrl}`);
        confidence += 0.1;
      }
    }

    // Additional confidence reduction for very poor input
    if (input.trim().length === 0) {
      confidence -= 0.2; // Extra penalty for empty input
    }

    if (methods.length === 0) {
      assumptions.push("Defaulting to GET method");
      methods.push("GET");
      confidence -= 0.1;
    }

    // Create requests
    const requests = this.createRequests(
      urls,
      methods,
      headers,
      bodies,
      assumptions
    );

    if (requests.length === 0) {
      warnings.push("Could not create any valid requests");
      confidence = 0.2;

      // Create a minimal default request
      requests.push({
        method: "GET",
        url: "http://example.com",
        headers: {},
        body: "",
      });
      assumptions.push("Created default request due to parsing failure");
    }

    // Create load pattern
    const loadPattern = this.createLoadPattern(loadConfig, assumptions);

    // Generate test name
    const testName = this.generateTestName(input, urls);

    const spec: LoadTestSpec = {
      id: `fallback-${Date.now()}`,
      name: testName,
      description: `Fallback parsed: ${input.substring(0, 100)}...`,
      testType: "baseline",
      duration: { value: 30, unit: "seconds" },
      requests,
      loadPattern,
    };

    // Adjust confidence based on completeness
    confidence = this.adjustConfidenceBasedOnCompleteness(
      spec,
      confidence,
      warnings
    );

    return {
      spec,
      confidence: Math.max(0.1, Math.min(0.95, confidence)), // Cap at 0.95 instead of 1.0
      warnings,
      assumptions,
    };
  }

  private extractUrls(input: string): string[] {
    const urls = new Set<string>();

    for (const pattern of this.rules.urlPatterns) {
      const matches = input.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          // Clean up the URL - remove trailing punctuation and whitespace
          const cleanUrl = match.replace(/[,;]+$/, "").trim();
          if (this.isValidUrl(cleanUrl)) {
            urls.add(cleanUrl);
          }
        });
      }
    }

    return Array.from(urls);
  }

  private extractMethods(input: string): string[] {
    const methods = new Set<string>();
    const validMethods = [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "PATCH",
      "HEAD",
      "OPTIONS",
    ];

    for (const pattern of this.rules.methodPatterns) {
      let match;
      while ((match = pattern.exec(input)) !== null) {
        let method = match[0];

        // Handle method: pattern
        if (method.toLowerCase().includes("method:")) {
          method = method.replace(/method:\s*/i, "").trim();
        }

        method = method.trim().toUpperCase();

        // Only add if it's a valid HTTP method
        if (validMethods.includes(method)) {
          methods.add(method);
        }
      }
    }

    return Array.from(methods);
  }

  private extractHeaders(input: string): Record<string, string>[] {
    const headerSets: Record<string, string>[] = [];
    const currentHeaders: Record<string, string> = {};

    for (const pattern of this.rules.headerPatterns) {
      let match;
      while ((match = pattern.exec(input)) !== null) {
        const [, key, value] = match;
        if (key && value && this.isValidHeaderKey(key) && !this.isUrl(value)) {
          // Clean up header value by removing trailing punctuation
          const cleanValue = value.trim().replace(/[;,]+$/, "");
          currentHeaders[key.trim()] = cleanValue;
        }
      }
    }

    if (Object.keys(currentHeaders).length > 0) {
      headerSets.push(currentHeaders);
    }

    return headerSets;
  }

  private extractBodies(input: string): string[] {
    const bodies: string[] = [];

    for (const pattern of this.rules.bodyPatterns) {
      const matches = input.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          try {
            // Try to parse as JSON to validate
            const cleanBody = match.replace(/^(?:body|data):\s*/i, "").trim();
            JSON.parse(cleanBody);
            bodies.push(cleanBody);
          } catch {
            // If not valid JSON, still include if it looks like structured data
            if (match.includes("{") && match.includes("}")) {
              bodies.push(match.trim());
            }
          }
        });
      }
    }

    return bodies;
  }

  private extractLoadConfiguration(input: string): Record<string, string> {
    const config: Record<string, string> = {};

    // Enhanced patterns for better extraction
    const enhancedPatterns = [
      ...this.rules.loadPatterns,
      /(\d+)\s*minutes?/gi,
      /for\s+(\d+)\s*m(?:in)?/gi,
      /(\d+)m\b/gi,
    ];

    for (const pattern of enhancedPatterns) {
      let match;
      while ((match = pattern.exec(input)) !== null) {
        const [fullMatch, value] = match;

        if (
          fullMatch.toLowerCase().includes("user") ||
          fullMatch.toLowerCase().includes("concurrent")
        ) {
          config.users = value;
        } else if (
          fullMatch.toLowerCase().includes("duration") ||
          fullMatch.toLowerCase().includes("for") ||
          fullMatch.toLowerCase().includes("minute")
        ) {
          // Convert minutes to proper format, avoid double 'm'
          if (
            (fullMatch.toLowerCase().includes("minute") ||
              fullMatch.includes("m")) &&
            !value.includes("m")
          ) {
            config.duration = `${value}m`;
          } else {
            config.duration = value;
          }
        } else if (fullMatch.toLowerCase().includes("rate")) {
          config.rate = value;
        } else if (fullMatch.toLowerCase().includes("ramp")) {
          config.rampUp = value;
        }
      }
    }

    return config;
  }

  private createRequests(
    urls: string[],
    methods: string[],
    headerSets: Record<string, string>[],
    bodies: string[],
    assumptions: string[]
  ): RequestSpec[] {
    const requests: RequestSpec[] = [];

    // Create requests based on URLs primarily
    if (urls.length > 0) {
      // Create one request per URL
      urls.forEach((url, index) => {
        const method = methods[index] || methods[0] || "GET";
        const headers = headerSets[index] || headerSets[0] || {};
        const body = bodies[index] || bodies[0] || "";

        // Add Content-Type header for POST requests with JSON body
        const finalHeaders = { ...headers };
        if (
          ["POST", "PUT", "PATCH"].includes(method) &&
          body &&
          body.includes("{")
        ) {
          if (!finalHeaders["Content-Type"] && !finalHeaders["content-type"]) {
            finalHeaders["Content-Type"] = "application/json";
          }
        }

        requests.push({
          method: method as any,
          url,
          headers: finalHeaders,
          body,
        });
      });

      // If we have more methods than URLs, create additional requests with the first URL
      if (methods.length > urls.length) {
        const baseUrl = urls[0];
        methods.slice(urls.length).forEach((method, index) => {
          const headers =
            headerSets[index + urls.length] || headerSets[0] || {};
          const body = bodies[index + urls.length] || bodies[0] || "";

          const finalHeaders = { ...headers };
          if (
            ["POST", "PUT", "PATCH"].includes(method) &&
            body &&
            body.includes("{")
          ) {
            if (
              !finalHeaders["Content-Type"] &&
              !finalHeaders["content-type"]
            ) {
              finalHeaders["Content-Type"] = "application/json";
            }
          }

          requests.push({
            method: method as any,
            url: baseUrl,
            headers: finalHeaders,
            body,
          });

          assumptions.push(
            `Created additional ${method} request using base URL: ${baseUrl}`
          );
        });
      }
    } else {
      // No URLs found, create default request
      requests.push({
        method: "GET",
        url: "http://example.com",
        headers: {},
        body: "",
      });
      assumptions.push("Created default request due to parsing failure");
    }

    return requests;
  }

  private createLoadPattern(
    config: Record<string, string>,
    assumptions: string[]
  ) {
    // Default load pattern
    let loadPattern: any = {
      type: "constant",
      virtualUsers: 10,
    };

    // Apply extracted configuration
    if (config.users) {
      const users = parseInt(config.users);
      if (!isNaN(users)) {
        loadPattern.rate = users;
      }
    }

    if (config.rate) {
      const rate = parseInt(config.rate);
      if (!isNaN(rate)) {
        loadPattern.rate = rate;
      }
    }

    if (config.duration) {
      loadPattern.duration = config.duration;
    }

    if (config.rampUp) {
      loadPattern = {
        type: "ramp-up",
        duration: loadPattern.duration,
        virtualUsers: loadPattern.virtualUsers,
        rampUpTime: config.rampUp,
      };
      assumptions.push(`Using ramp-up pattern with duration: ${config.rampUp}`);
    }

    // Add assumption if using defaults
    if (Object.keys(config).length === 0) {
      assumptions.push(
        "Using default load pattern: 10 requests/second for 30 seconds"
      );
    }

    return loadPattern;
  }

  private generateTestName(input: string, urls: string[]): string {
    // First try explicit name patterns
    const explicitNameMatch = input.match(
      /(?:test|name|title):\s*([^\r\n,]+)/gi
    );
    if (explicitNameMatch && explicitNameMatch[0]) {
      let name = explicitNameMatch[0].trim();
      name = name.replace(/^(name|test|title):\s*/i, "");
      if (name.length > 0) {
        return name;
      }
    }

    // Try to use first line if it doesn't look like a command or URL
    const firstLineMatch = input.match(/^([^\r\n]{1,50})/);
    if (firstLineMatch && firstLineMatch[1]) {
      const firstLine = firstLineMatch[1].trim();
      // Use first line if it doesn't look like a URL, HTTP method, or contain URLs
      if (
        !this.isUrl(firstLine) &&
        !/^(GET|POST|PUT|DELETE|PATCH)\s/.test(firstLine) &&
        !firstLine.includes("http://") &&
        !firstLine.includes("https://") &&
        firstLine.length > 5 // Ensure it's meaningful
      ) {
        return firstLine;
      }
    }

    // If we have URLs, prefer URL-based names
    if (urls.length > 0) {
      try {
        const url = new URL(urls[0]);
        return `Load test for ${url.hostname}`;
      } catch {
        return `Load test for ${urls[0]}`;
      }
    }

    // Final fallback - only use input as name if it's very short and meaningful
    const trimmedInput = input.trim();
    if (
      trimmedInput.length < 30 && // Shorter threshold
      trimmedInput.length > 5 && // Not too short
      !this.isUrl(trimmedInput) &&
      !trimmedInput.includes("http") &&
      trimmedInput.split(" ").length <= 5 && // Fewer words
      !/^\s*$/.test(trimmedInput) && // Not just whitespace
      !trimmedInput.toLowerCase().includes("structure") && // Avoid test-specific words
      !trimmedInput.toLowerCase().includes("random") && // Avoid test-specific words
      !trimmedInput.toLowerCase().includes("clear") // Avoid test-specific words
    ) {
      return trimmedInput;
    }

    return "Fallback load test";
  }

  private inferUrl(input: string): string | null {
    // Try to infer URL from common patterns
    const inferencePatterns = [
      /(?:server|host|domain)[\s:]+([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
      /(?:test|load|target)\s+([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
      /\b([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
    ];

    for (const pattern of inferencePatterns) {
      const match = pattern.exec(input);
      if (match && match[1]) {
        const domain = match[1].trim();
        return `http://${domain}`;
      }
    }

    return null;
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private isUrl(text: string): boolean {
    return (
      text.startsWith("http://") ||
      text.startsWith("https://") ||
      text.startsWith("//")
    );
  }

  private isValidHeaderKey(key: string): boolean {
    // Valid HTTP header names contain only letters, digits, and hyphens
    return /^[a-zA-Z][a-zA-Z0-9-]*$/.test(key) && key.length > 1;
  }

  private adjustConfidenceBasedOnCompleteness(
    spec: LoadTestSpec,
    baseConfidence: number,
    warnings: string[]
  ): number {
    let confidence = baseConfidence;

    // Reduce confidence for each warning
    confidence -= warnings.length * 0.1;

    // Increase confidence for complete requests
    if (spec.requests.length > 0) {
      const completeRequests = spec.requests.filter(
        (req) => req.url && req.method && this.isValidUrl(req.url)
      );

      const completenessRatio = completeRequests.length / spec.requests.length;
      confidence += completenessRatio * 0.2;
    }

    // Increase confidence if we have headers
    const requestsWithHeaders = spec.requests.filter(
      (req) => Object.keys(req.headers || {}).length > 0
    );
    if (requestsWithHeaders.length > 0) {
      confidence += 0.1;
    }

    // Increase confidence if we have bodies for POST/PUT requests
    const postRequests = spec.requests.filter((req) =>
      ["POST", "PUT", "PATCH"].includes(req.method)
    );
    const postRequestsWithBodies = postRequests.filter((req) => req.body);
    if (
      postRequests.length > 0 &&
      postRequestsWithBodies.length === postRequests.length
    ) {
      confidence += 0.1;
    }

    return confidence;
  }
}
