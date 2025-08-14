/**
 * Smart prompt building system for dynamic prompt construction
 * Creates contextual prompts with examples and clarifications based on input format and content
 */

import { ParseContext } from "./context-enhancer";
import { InputFormat } from "./format-detector";
import { LoadTestSpec } from "../types";

export interface PromptExample {
  input: string;
  output: LoadTestSpec;
  description: string;
  relevanceScore?: number;
}

export interface EnhancedPrompt {
  systemPrompt: string;
  contextualExamples: PromptExample[];
  clarifications: string[];
  parsingInstructions: string[];
  fallbackInstructions: string[];
}

export interface ExampleRule {
  condition: (context: ParseContext) => boolean;
  examples: PromptExample[];
  priority: number;
}

export interface DynamicPromptTemplate {
  basePrompt: string;
  contextualInstructions: Record<InputFormat, string>;
  exampleSelectionRules: ExampleRule[];
  ambiguityHandlingInstructions: string[];
  fallbackInstructions: string[];
}

export interface SmartPromptBuilder {
  buildPrompt(context: ParseContext): EnhancedPrompt;
  selectRelevantExamples(context: ParseContext): PromptExample[];
  addClarifications(context: ParseContext): string[];
}

export class DefaultSmartPromptBuilder implements SmartPromptBuilder {
  private readonly promptTemplate: DynamicPromptTemplate;
  private readonly exampleLibrary: PromptExample[];

  constructor() {
    this.exampleLibrary = this.createExampleLibrary();
    this.promptTemplate = this.createPromptTemplate();
  }

  buildPrompt(context: ParseContext): EnhancedPrompt {
    // Get format-specific instructions
    const formatInstructions = this.getFormatInstructions(context);

    // Build enhanced system prompt
    const systemPrompt = this.buildSystemPrompt(context, formatInstructions);

    // Select relevant examples
    const contextualExamples = this.selectRelevantExamples(context);

    // Generate clarifications for ambiguities
    const clarifications = this.addClarifications(context);

    // Create parsing instructions
    const parsingInstructions = this.createParsingInstructions(context);

    // Create fallback instructions
    const fallbackInstructions = this.createFallbackInstructions(context);

    return {
      systemPrompt,
      contextualExamples,
      clarifications,
      parsingInstructions,
      fallbackInstructions,
    };
  }

  selectRelevantExamples(context: ParseContext): PromptExample[] {
    const selectedExamples: PromptExample[] = [];

    // Apply example selection rules
    for (const rule of this.promptTemplate.exampleSelectionRules) {
      if (rule.condition(context)) {
        // Score examples based on relevance
        const scoredExamples = rule.examples.map((example) => ({
          ...example,
          relevanceScore: this.calculateRelevanceScore(example, context),
        }));

        // Sort by relevance and add to selection
        scoredExamples
          .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
          .slice(0, 2) // Limit to top 2 examples per rule
          .forEach((example) => selectedExamples.push(example));
      }
    }

    // Remove duplicates and limit total examples
    const uniqueExamples = selectedExamples.filter(
      (example, index, array) =>
        array.findIndex((e) => e.input === example.input) === index
    );

    return uniqueExamples.slice(0, 5); // Maximum 5 examples
  }

  addClarifications(context: ParseContext): string[] {
    const clarifications: string[] = [];

    // Add clarifications for each ambiguity
    context.ambiguities.forEach((ambiguity) => {
      const clarification = this.generateClarificationForAmbiguity(ambiguity);
      if (clarification) {
        clarifications.push(clarification);
      }
    });

    // Add format-specific clarifications
    const formatClarifications = this.getFormatSpecificClarifications(context);
    clarifications.push(...formatClarifications);

    // Add confidence-based clarifications
    if (context.confidence < 0.6) {
      clarifications.push(
        "Input appears ambiguous or incomplete. Make reasonable assumptions and document them clearly."
      );
    }

    return clarifications;
  }

  private createExampleLibrary(): PromptExample[] {
    return [
      {
        input: "POST to /api/users with 50 concurrent users for 2 minutes",
        output: {
          id: "test_post_users",
          name: "POST Users API Test",
          description:
            "POST to /api/users with 50 concurrent users for 2 minutes",
          testType: "baseline",
          requests: [
            {
              method: "POST",
              url: "/api/users",
              headers: { "Content-Type": "application/json" },
              payload: {
                template: '{"name": "{{name}}", "email": "{{email}}"}',
                variables: [
                  {
                    name: "name",
                    type: "random_string",
                    parameters: { length: 8 },
                  },
                  { name: "email", type: "random_string", parameters: {} },
                ],
              },
            },
          ],
          loadPattern: { type: "constant", virtualUsers: 50 },
          duration: { value: 2, unit: "minutes" },
        },
        description: "Simple POST request with concurrent users",
      },
      {
        input:
          "Spike test: 1000 requests to GET https://api.example.com/health in 10 seconds",
        output: {
          id: "test_spike_health",
          name: "Health Check Spike Test",
          description:
            "Spike test: 1000 requests to GET https://api.example.com/health in 10 seconds",
          testType: "spike",
          requests: [
            {
              method: "GET",
              url: "https://api.example.com/health",
            },
          ],
          loadPattern: { type: "spike", virtualUsers: 1000 },
          duration: { value: 10, unit: "seconds" },
        },
        description: "Spike test with high load in short duration",
      },
      {
        input:
          "curl -X POST https://api.example.com/orders -H 'Content-Type: application/json' -d '{\"productId\": 123}'",
        output: {
          id: "test_curl_orders",
          name: "Orders API Test",
          description:
            "curl -X POST https://api.example.com/orders -H 'Content-Type: application/json' -d '{\"productId\": 123}'",
          testType: "baseline",
          requests: [
            {
              method: "POST",
              url: "https://api.example.com/orders",
              headers: { "Content-Type": "application/json" },
              payload: {
                template: '{"productId": {{productId}}}',
                variables: [
                  {
                    name: "productId",
                    type: "sequence",
                    parameters: { min: 1, max: 1000 },
                  },
                ],
              },
            },
          ],
          loadPattern: { type: "constant", virtualUsers: 10 },
          duration: { value: 1, unit: "minutes" },
        },
        description: "Curl command with JSON payload",
      },
      {
        input:
          "Stress test gradually increasing from 10 to 200 users over 5 minutes hitting /api/login",
        output: {
          id: "test_stress_login",
          name: "Login Stress Test",
          description:
            "Stress test gradually increasing from 10 to 200 users over 5 minutes hitting /api/login",
          testType: "stress",
          requests: [
            {
              method: "POST",
              url: "/api/login",
              headers: { "Content-Type": "application/json" },
              payload: {
                template:
                  '{"username": "{{username}}", "password": "{{password}}"}',
                variables: [
                  {
                    name: "username",
                    type: "random_string",
                    parameters: { length: 8 },
                  },
                  {
                    name: "password",
                    type: "random_string",
                    parameters: { length: 12 },
                  },
                ],
              },
            },
          ],
          loadPattern: {
            type: "ramp-up",
            virtualUsers: 200,
            rampUpTime: { value: 5, unit: "minutes" },
          },
          duration: { value: 10, unit: "minutes" },
        },
        description: "Gradual ramp-up stress test",
      },
      {
        input:
          "GET /api/products?category=electronics Authorization: Bearer token123",
        output: {
          id: "test_products_auth",
          name: "Products API with Auth",
          description:
            "GET /api/products?category=electronics Authorization: Bearer token123",
          testType: "baseline",
          requests: [
            {
              method: "GET",
              url: "/api/products?category=electronics",
              headers: { Authorization: "Bearer token123" },
            },
          ],
          loadPattern: { type: "constant", virtualUsers: 10 },
          duration: { value: 1, unit: "minutes" },
        },
        description: "GET request with query parameters and authentication",
      },
    ];
  }

  private createPromptTemplate(): DynamicPromptTemplate {
    return {
      basePrompt: `You are StressMaster's enhanced AI assistant that converts various input formats into structured load test specifications.

Your task is to intelligently parse user input and extract:
- HTTP method, URL, headers, and request body
- Load pattern (constant, ramp-up, spike, step)
- Test duration and virtual users or RPS
- Test type (spike, stress, endurance, volume, baseline)

Always respond with valid JSON matching the LoadTestSpec interface. Use the provided context and examples to make intelligent decisions about ambiguous input.`,

      contextualInstructions: {
        natural_language:
          "Focus on extracting intent from natural language descriptions. Infer technical details from context clues.",
        mixed_structured:
          "Parse both structured data and natural language. Prioritize explicit structured data over inferred values.",
        curl_command:
          "Extract all parameters from the curl command. Pay attention to headers, method, and data flags.",
        http_raw:
          "Parse the raw HTTP request format. Extract method, path, headers, and body from the HTTP structure.",
        json_with_text:
          "Extract JSON blocks as request bodies. Use surrounding text for context and configuration.",
        concatenated_requests:
          "Identify and separate multiple requests. Create appropriate test scenarios for each.",
      },

      exampleSelectionRules: [
        {
          condition: (context) =>
            context.extractedComponents.methods.includes("POST"),
          examples: this.exampleLibrary.filter(
            (ex) => ex.output.requests[0]?.method === "POST"
          ),
          priority: 1,
        },
        {
          condition: (context) =>
            context.extractedComponents.counts.some((c) => c > 100),
          examples: this.exampleLibrary.filter(
            (ex) =>
              ex.output.loadPattern.virtualUsers &&
              ex.output.loadPattern.virtualUsers > 100
          ),
          priority: 2,
        },
        {
          condition: (context) => context.inferredFields.testType === "spike",
          examples: this.exampleLibrary.filter(
            (ex) => ex.output.testType === "spike"
          ),
          priority: 1,
        },
        {
          condition: (context) =>
            context.extractedComponents.methods.includes("GET"),
          examples: this.exampleLibrary.filter(
            (ex) => ex.output.requests[0]?.method === "GET"
          ),
          priority: 1,
        },
        {
          condition: (context) => context.inferredFields.testType === "stress",
          examples: this.exampleLibrary.filter(
            (ex) => ex.output.testType === "stress"
          ),
          priority: 1,
        },
        {
          condition: () => true, // Fallback rule - always matches
          examples: this.exampleLibrary,
          priority: 10, // Lowest priority
        },
      ],

      ambiguityHandlingInstructions: [
        "When multiple values are possible, choose the most common or reasonable default",
        "Document all assumptions made during parsing",
        "Prefer explicit values over inferred ones",
        "Use context clues to resolve ambiguities",
      ],

      fallbackInstructions: [
        "If parsing fails, extract whatever components are clearly identifiable",
        "Use reasonable defaults for missing required fields",
        "Maintain valid JSON structure even with incomplete data",
        "Provide helpful error messages in the response",
      ],
    };
  }

  private getFormatInstructions(context: ParseContext): string {
    // Determine the most likely format based on context
    const format = this.inferInputFormat(context);
    return (
      this.promptTemplate.contextualInstructions[format] ||
      this.promptTemplate.contextualInstructions.natural_language
    );
  }

  private inferInputFormat(context: ParseContext): InputFormat {
    const input = context.originalInput.toLowerCase();

    if (input.includes("curl")) return "curl_command";
    if (input.match(/^(get|post|put|delete)\s+\/\S*\s+http\/\d\.\d/m))
      return "http_raw";
    if (context.extractedComponents.bodies.length > 0 && input.length > 100)
      return "json_with_text";
    if (
      context.extractedComponents.urls.length > 1 ||
      context.extractedComponents.methods.length > 1
    )
      return "concatenated_requests";
    if (
      context.extractedComponents.urls.length > 0 ||
      context.extractedComponents.methods.length > 0
    )
      return "mixed_structured";

    return "natural_language";
  }

  private buildSystemPrompt(
    context: ParseContext,
    formatInstructions: string
  ): string {
    let systemPrompt = this.promptTemplate.basePrompt;

    // Add format-specific instructions
    systemPrompt += `\n\nFormat-specific instructions: ${formatInstructions}`;

    // Add confidence-based instructions
    if (context.confidence < 0.5) {
      systemPrompt +=
        "\n\nNote: Input appears to have low confidence. Make conservative assumptions and clearly document them.";
    }

    // Add ambiguity handling instructions
    if (context.ambiguities.length > 0) {
      systemPrompt += `\n\nAmbiguity handling: ${this.promptTemplate.ambiguityHandlingInstructions.join(
        " "
      )}`;
    }

    return systemPrompt;
  }

  private calculateRelevanceScore(
    example: PromptExample,
    context: ParseContext
  ): number {
    let score = 0;

    // Method matching
    if (
      example.output.requests[0]?.method &&
      context.extractedComponents.methods.includes(
        example.output.requests[0].method
      )
    ) {
      score += 0.3;
    }

    // Test type matching
    if (example.output.testType === context.inferredFields.testType) {
      score += 0.3;
    }

    // Load pattern matching
    if (
      example.output.loadPattern.type === context.inferredFields.loadPattern
    ) {
      score += 0.2;
    }

    // URL pattern matching
    const exampleUrl = example.output.requests[0]?.url || "";
    const hasMatchingUrlPattern = context.extractedComponents.urls.some(
      (url) =>
        url.includes(exampleUrl.split("/").pop() || "") ||
        exampleUrl.includes(url.split("/").pop() || "")
    );
    if (hasMatchingUrlPattern) {
      score += 0.2;
    }

    return score;
  }

  private generateClarificationForAmbiguity(ambiguity: any): string | null {
    switch (ambiguity.field) {
      case "method":
        return `HTTP method not specified. Will default to ${ambiguity.possibleValues[0]} based on context.`;
      case "url":
        return `URL incomplete or missing. ${ambiguity.reason}`;
      case "userCount":
        return `User count not specified. Will use default of ${ambiguity.possibleValues[0]} concurrent users.`;
      case "duration":
        return `Test duration not specified. Will use default of ${ambiguity.possibleValues[0]}.`;
      case "content-type":
        return `Content-Type header missing for request with body. Will default to ${ambiguity.possibleValues[0]}.`;
      default:
        return `${ambiguity.field}: ${ambiguity.reason}`;
    }
  }

  private getFormatSpecificClarifications(context: ParseContext): string[] {
    const clarifications: string[] = [];
    const format = this.inferInputFormat(context);

    switch (format) {
      case "curl_command":
        clarifications.push(
          "Parsing curl command - extracting all flags and parameters."
        );
        break;
      case "http_raw":
        clarifications.push(
          "Parsing raw HTTP request format - extracting method, headers, and body."
        );
        break;
      case "concatenated_requests":
        clarifications.push(
          "Multiple requests detected - will create separate test scenarios."
        );
        break;
      case "json_with_text":
        clarifications.push(
          "JSON data found with descriptive text - using JSON as request body."
        );
        break;
      case "mixed_structured":
        clarifications.push(
          "Mixed structured and natural language input - prioritizing structured data."
        );
        break;
    }

    return clarifications;
  }

  private createParsingInstructions(context: ParseContext): string[] {
    const instructions: string[] = [];

    // Add instructions based on extracted components
    if (context.extractedComponents.methods.length > 0) {
      instructions.push(
        `Use HTTP method: ${context.extractedComponents.methods[0]}`
      );
    }

    if (context.extractedComponents.urls.length > 0) {
      instructions.push(`Target URL: ${context.extractedComponents.urls[0]}`);
    }

    if (context.extractedComponents.counts.length > 0) {
      instructions.push(`User count: ${context.extractedComponents.counts[0]}`);
    }

    // Add instructions based on inferred fields
    if (context.inferredFields.testType) {
      instructions.push(`Test type: ${context.inferredFields.testType}`);
    }

    if (context.inferredFields.loadPattern) {
      instructions.push(`Load pattern: ${context.inferredFields.loadPattern}`);
    }

    return instructions;
  }

  private createFallbackInstructions(context: ParseContext): string[] {
    const instructions = [...this.promptTemplate.fallbackInstructions];

    // Add context-specific fallback instructions
    if (context.confidence < 0.3) {
      instructions.push(
        "Very low confidence input - use minimal viable test configuration"
      );
    }

    if (context.ambiguities.length > 3) {
      instructions.push(
        "High ambiguity input - prioritize most critical components (method, URL)"
      );
    }

    return instructions;
  }
}
