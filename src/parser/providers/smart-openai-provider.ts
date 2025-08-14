/**
 * Smart OpenAI Provider - Extends OpenAI provider with smart parsing capabilities
 * Supports GPT-3.5, GPT-4, and other OpenAI models with enhanced parsing
 */

import { SmartBaseAIProvider, SmartAIProvider } from "../smart-ai-provider";
import {
  CompletionRequest,
  CompletionResponse,
  AIProviderConfig,
} from "../ai-provider";

export class SmartOpenAIProvider
  extends SmartBaseAIProvider
  implements SmartAIProvider
{
  private static readonly DEFAULT_ENDPOINT = "https://api.openai.com/v1";
  private static readonly DEFAULT_MODEL = "gpt-3.5-turbo";

  constructor(config: AIProviderConfig) {
    super({
      endpoint: SmartOpenAIProvider.DEFAULT_ENDPOINT,
      ...config,
      model: config.model || SmartOpenAIProvider.DEFAULT_MODEL,
    });
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error(
        "OpenAI API key is required. Set AI_API_KEY environment variable."
      );
    }

    // Test the API key with a simple request
    try {
      const isHealthy = await this.healthCheck();
      if (!isHealthy) {
        throw new Error("Health check failed");
      }
      this.isInitialized = true;
      console.log(
        `Smart OpenAI Provider initialized with model: ${this.config.model}`
      );
    } catch (error) {
      throw new Error(`Failed to initialize Smart OpenAI provider: ${error}`);
    }
  }

  async generateCompletion(
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    const startTime = Date.now();

    return this.retryOperation(async () => {
      const response = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model || this.config.model,
          messages: [
            {
              role: "system",
              content: this.buildSystemMessage(request),
            },
            {
              role: "user",
              content: request.prompt,
            },
          ],
          temperature: request.temperature || 0.1,
          max_tokens: request.maxTokens || 2000,
          response_format:
            request.format === "json" ? { type: "json_object" } : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as any;
        throw new Error(
          `OpenAI API error: ${response.status} - ${
            errorData.error?.message || response.statusText
          }`
        );
      }

      const data = (await response.json()) as any;
      const duration = Date.now() - startTime;

      return {
        response: data.choices[0].message.content,
        model: data.model,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        },
        metadata: {
          provider: "smart-openai",
          duration,
        },
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.endpoint}/models`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  getProviderName(): string {
    return "Smart OpenAI";
  }

  private buildSystemMessage(request: CompletionRequest): string {
    // Enhanced system message for better parsing
    let systemMessage = `You are StressMaster's advanced AI assistant that converts user input into structured load test specifications.

Your task is to intelligently parse user input and return a valid JSON object matching the LoadTestSpec interface.

Key capabilities:
- Parse natural language mixed with structured data
- Handle messy, incomplete, or ambiguous input
- Extract HTTP methods, URLs, headers, and request bodies
- Infer reasonable defaults for missing information
- Generate appropriate load patterns and test configurations

Required JSON structure:
{
  "id": "string (generate unique identifier)",
  "name": "string (descriptive test name)",
  "description": "string (copy of original input)",
  "testType": "baseline" | "spike" | "stress" | "endurance" | "volume",
  "requests": [
    {
      "method": "GET|POST|PUT|DELETE|PATCH",
      "url": "complete URL or path",
      "headers": { "optional": "headers" },
      "payload": {
        "template": "request body template",
        "variables": [
          {
            "name": "variable_name",
            "type": "random_string|random_number|random_email",
            "parameters": {}
          }
        ]
      }
    }
  ],
  "loadPattern": {
    "type": "constant|ramp-up|spike|step",
    "virtualUsers": number,
    "rampUpTime": { "value": number, "unit": "seconds|minutes|hours" }
  },
  "duration": {
    "value": number,
    "unit": "seconds|minutes|hours"
  }
}

Parsing guidelines:
- If HTTP method is missing, infer from context (GET for read, POST for write)
- If URL is incomplete, use reasonable defaults or localhost
- If user count is missing, use sensible defaults (1-100 based on context)
- If duration is missing, use appropriate defaults (30s-5m based on test type)
- For POST/PUT requests without Content-Type, add "application/json"
- Generate meaningful test names and descriptions
- Use appropriate load patterns based on test type`;

    // Add format-specific instructions if available
    if (request.format === "json") {
      systemMessage += `\n\nIMPORTANT: Respond with valid JSON only. Do not include explanations, markdown formatting, or code blocks.`;
    }

    return systemMessage;
  }
}
