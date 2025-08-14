import { LoadTestSpec } from "../types";

export interface PromptTemplate {
  systemPrompt: string;
  userPromptTemplate: string;
  examples: PromptExample[];
}

export interface PromptExample {
  input: string;
  output: LoadTestSpec;
}

export class PromptTemplateManager {
  private static readonly SYSTEM_PROMPT = `You are StressMaster's AI assistant that converts natural language descriptions into structured load test specifications. 

Your task is to parse user commands and extract the following information:
- HTTP method (GET, POST, PUT, DELETE, etc.)
- Target URL
- Request payload template and variables
- Load pattern (constant, ramp-up, spike, step)
- Test duration and virtual users or RPS
- Test type (spike, stress, endurance, volume, baseline)

Always respond with valid JSON that matches the LoadTestSpec interface. If information is missing or ambiguous, use reasonable defaults and note ambiguities.

Key guidelines:
1. Generate unique IDs using timestamp-based approach
2. Infer test type from the language used (e.g., "spike test" = spike, "gradually increase" = stress)
3. Default to POST for requests with payloads, GET otherwise
4. Use reasonable defaults for missing parameters
5. Extract variable definitions from payload descriptions
6. Set appropriate load patterns based on the test description
7. When a complete JSON object is provided in the input, use it EXACTLY as the "body" field - do NOT create template variables
8. If JSON contains specific values like "requestId": "ai-req-stress29", preserve them as literal values, not as {{requestId}} templates
9. NEVER extract individual fields from a complete JSON - use the whole JSON object as the body

CRITICAL: If the input contains a complete JSON object like {"requestId": "example123", "payload": [...]}, use it EXACTLY as the "body" field. Do NOT create variables or templates from literal values.

Response format must be valid JSON matching this TypeScript interface:
{
  "id": "string",
  "name": "string", 
  "description": "string",
  "testType": "spike" | "stress" | "endurance" | "volume" | "baseline",
  "requests": [RequestSpec],
  "loadPattern": LoadPattern,
  "duration": Duration,
  "workflow": WorkflowStep[] (optional),
  "dataCorrelation": CorrelationRule[] (optional)
}`;

  private static readonly USER_PROMPT_TEMPLATE = `Parse this StressMaster command and convert it to a LoadTestSpec JSON:

Command: "{input}"

Respond with only valid JSON, no additional text or explanation.`;

  private static readonly EXAMPLES: PromptExample[] = [
    {
      input:
        "Send 100 POST requests to https://api.example.com/orders with random orderIds",
      output: {
        id: "test_" + Date.now(),
        name: "POST Orders Test",
        description:
          "Send 100 POST requests to https://api.example.com/orders with random orderIds",
        testType: "baseline",
        requests: [
          {
            method: "POST",
            url: "https://api.example.com/orders",
            headers: {
              "Content-Type": "application/json",
            },
            payload: {
              template: '{"orderId": "{{orderId}}"}',
              variables: [
                {
                  name: "orderId",
                  type: "random_id",
                  parameters: {},
                },
              ],
            },
          },
        ],
        loadPattern: {
          type: "constant",
          virtualUsers: 100,
        },
        duration: {
          value: 1,
          unit: "minutes",
        },
      },
    },
    {
      input: "Spike test with 1000 requests in 10 seconds to GET /api/users",
      output: {
        id: "test_" + Date.now(),
        name: "Spike Test Users API",
        description:
          "Spike test with 1000 requests in 10 seconds to GET /api/users",
        testType: "spike",
        requests: [
          {
            method: "GET",
            url: "/api/users",
          },
        ],
        loadPattern: {
          type: "spike",
          virtualUsers: 1000,
        },
        duration: {
          value: 10,
          unit: "seconds",
        },
      },
    },
    {
      input:
        "Stress test gradually increasing from 10 to 100 users over 5 minutes for POST /api/login",
      output: {
        id: "test_" + Date.now(),
        name: "Stress Test Login API",
        description:
          "Stress test gradually increasing from 10 to 100 users over 5 minutes for POST /api/login",
        testType: "stress",
        requests: [
          {
            method: "POST",
            url: "/api/login",
            headers: {
              "Content-Type": "application/json",
            },
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
          virtualUsers: 100,
          rampUpTime: {
            value: 5,
            unit: "minutes",
          },
        },
        duration: {
          value: 10,
          unit: "minutes",
        },
      },
    },
    {
      input:
        'send 3 POST requests to https://api.example.com/orders with header x-api-key abc123 {"requestId": "order-123", "payload": [{"externalId": "ORD#1"}]}',
      output: {
        id: "test_" + Date.now(),
        name: "Load Test Orders API",
        description:
          "Send 3 POST requests to orders endpoint with specific JSON payload",
        testType: "baseline",
        requests: [
          {
            method: "POST",
            url: "https://api.example.com/orders",
            headers: {
              "x-api-key": "abc123",
              "Content-Type": "application/json",
            },
            body: {
              requestId: "order-123",
              payload: [{ externalId: "ORD#1" }],
            },
          },
        ],
        loadPattern: {
          type: "constant",
          virtualUsers: 3,
        },
        duration: {
          value: 30,
          unit: "seconds",
        },
      },
    },
  ];

  static getSystemPrompt(): string {
    return this.SYSTEM_PROMPT;
  }

  static getUserPrompt(input: string): string {
    return this.USER_PROMPT_TEMPLATE.replace("{input}", input);
  }

  static getExamples(): PromptExample[] {
    return this.EXAMPLES;
  }

  static buildFullPrompt(input: string): string {
    const examples = this.EXAMPLES.map(
      (example) =>
        `Input: "${example.input}"\nOutput: ${JSON.stringify(
          example.output,
          null,
          2
        )}`
    ).join("\n\n");

    return `${this.SYSTEM_PROMPT}

Here are some examples:

${examples}

Now parse this command:
${this.getUserPrompt(input)}`;
  }

  static extractVariablesFromPayload(
    payloadDescription: string
  ): Array<{ name: string; type: string; parameters?: any }> {
    const variables: Array<{ name: string; type: string; parameters?: any }> =
      [];

    // Common patterns for variable extraction
    const patterns = [
      { regex: /random\s+(\w+)/gi, type: "random_string" },
      { regex: /(\w+)Id/gi, type: "random_id" },
      { regex: /uuid/gi, type: "uuid" },
      { regex: /timestamp/gi, type: "timestamp" },
      { regex: /sequence/gi, type: "sequence" },
    ];

    patterns.forEach((pattern) => {
      const matches = payloadDescription.matchAll(pattern.regex);
      for (const match of matches) {
        const name = match[1] || match[0];
        if (!variables.some((v) => v.name === name)) {
          variables.push({
            name: name.toLowerCase(),
            type: pattern.type as any,
            parameters: pattern.type === "random_string" ? { length: 10 } : {},
          });
        }
      }
    });

    return variables;
  }

  static inferTestType(input: string): string {
    const lowerInput = input.toLowerCase();

    if (lowerInput.includes("spike")) return "spike";
    if (
      lowerInput.includes("stress") ||
      lowerInput.includes("gradually") ||
      lowerInput.includes("ramp")
    )
      return "stress";
    if (
      lowerInput.includes("endurance") ||
      lowerInput.includes("sustained") ||
      lowerInput.includes("long")
    )
      return "endurance";
    if (
      lowerInput.includes("volume") ||
      lowerInput.includes("high volume") ||
      lowerInput.includes("many users")
    )
      return "volume";
    if (lowerInput.includes("baseline") || lowerInput.includes("benchmark"))
      return "baseline";

    return "baseline"; // default
  }

  static inferHttpMethod(input: string): string {
    const lowerInput = input.toLowerCase();

    if (
      lowerInput.includes("post") ||
      lowerInput.includes("create") ||
      lowerInput.includes("submit")
    )
      return "POST";
    if (lowerInput.includes("put") || lowerInput.includes("update"))
      return "PUT";
    if (lowerInput.includes("delete") || lowerInput.includes("remove"))
      return "DELETE";
    if (lowerInput.includes("patch") || lowerInput.includes("modify"))
      return "PATCH";
    if (
      lowerInput.includes("get") ||
      lowerInput.includes("fetch") ||
      lowerInput.includes("retrieve")
    )
      return "GET";

    // If payload is mentioned, likely POST
    if (
      lowerInput.includes("payload") ||
      lowerInput.includes("data") ||
      lowerInput.includes("body")
    )
      return "POST";

    return "GET"; // default
  }

  static extractDuration(input: string): {
    value: number;
    unit: "seconds" | "minutes" | "hours";
  } {
    const patterns = [
      { regex: /(\d+)\s*seconds?/i, unit: "seconds" as const },
      { regex: /(\d+)\s*minutes?/i, unit: "minutes" as const },
      { regex: /(\d+)\s*hours?/i, unit: "hours" as const },
      { regex: /(\d+)\s*secs?/i, unit: "seconds" as const },
      { regex: /(\d+)\s*mins?/i, unit: "minutes" as const },
      { regex: /(\d+)\s*hrs?/i, unit: "hours" as const },
    ];

    for (const pattern of patterns) {
      const match = input.match(pattern.regex);
      if (match) {
        return {
          value: parseInt(match[1]),
          unit: pattern.unit,
        };
      }
    }

    // Default duration
    return { value: 1, unit: "minutes" };
  }

  static extractRequestCount(input: string): number {
    const patterns = [
      /(\d+)\s*requests?/i,
      /(\d+)\s*calls?/i,
      /(\d+)\s*times?/i,
    ];

    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) {
        return parseInt(match[1]);
      }
    }

    return 100; // default
  }

  static extractRPS(input: string): number | undefined {
    const patterns = [
      /(\d+)\s*rps/i,
      /(\d+)\s*requests?\s*per\s*second/i,
      /(\d+)\s*req\/s/i,
    ];

    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) {
        return parseInt(match[1]);
      }
    }

    return undefined;
  }
}
