import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import { v4 as uuidv4 } from "uuid";
import { Observable, Subject } from "rxjs";
import {
  CLIInterface,
  CLIConfig,
  SessionContext,
  CLIPromptOptions,
} from "./cli-interface";
import { CommandHistoryManager } from "./command-history";
import { ResultDisplayManager } from "./result-display";
import {
  TestResult,
  ExportFormat,
  ProgressUpdate,
  LoadTestSpec,
} from "../types";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

export class InteractiveCLI implements CLIInterface {
  private config: CLIConfig;
  private history: CommandHistoryManager;
  private resultDisplay: ResultDisplayManager;
  private session: SessionContext;
  private progressSubject = new Subject<ProgressUpdate>();
  private isRunning = false;

  constructor(config: Partial<CLIConfig> = {}) {
    this.config = {
      interactive: true,
      outputFormat: "json",
      verbose: false,
      maxHistoryEntries: 1000,
      autoComplete: true,
      ...config,
    };

    this.history = new CommandHistoryManager(this.config.maxHistoryEntries);
    this.resultDisplay = new ResultDisplayManager();
    this.session = {
      sessionId: uuidv4(),
      startTime: new Date(),
      testHistory: [],
    };

    this.setupHistoryFile();
  }

  private async setupHistoryFile(): Promise<void> {
    if (!this.config.historyFile) {
      const homeDir = os.homedir();
      this.config.historyFile = path.join(
        homeDir,
        ".stressmaster-history.json"
      );
    }

    try {
      await this.history.loadFromFile(this.config.historyFile);
    } catch (error) {
      if (this.config.verbose) {
        console.warn(
          chalk.yellow(`Warning: Could not load history file: ${error}`)
        );
      }
    }
  }

  async startSession(): Promise<void> {
    this.isRunning = true;

    console.log(chalk.blue.bold("🚀 StressMaster"));
    console.log(
      chalk.gray("Type 'help' for available commands, 'exit' to quit")
    );
    console.log(chalk.gray(`Session ID: ${this.session.sessionId}`));
    console.log();

    if (this.config.interactive) {
      await this.startInteractiveMode();
    }
  }

  private async startInteractiveMode(): Promise<void> {
    while (this.isRunning) {
      try {
        const input = await this.promptForCommand({
          message: chalk.cyan("stressmaster> "),
          history: this.history.getRecentCommands(20),
          suggestions: this.getCommandSuggestions(),
        });

        if (input.trim() === "") continue;

        if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
          await this.shutdown();
          break;
        }

        if (input.toLowerCase() === "help") {
          this.displayHelp();
          continue;
        }

        if (input.toLowerCase() === "history") {
          this.displayHistory();
          continue;
        }

        if (input.toLowerCase() === "clear") {
          console.clear();
          continue;
        }

        if (input.toLowerCase().startsWith("export ")) {
          await this.handleExportCommand(input);
          continue;
        }

        await this.executeCommand(input);
      } catch (error) {
        console.error(chalk.red(`Error: ${error}`));
      }
    }
  }

  private async promptForCommand(options: CLIPromptOptions): Promise<string> {
    // Simple readline-based prompt to avoid inquirer compatibility issues
    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(options.message, (answer: string) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  private getCommandSuggestions(): string[] {
    return [
      "Send 100 GET requests to https://api.example.com",
      "Spike test with 1000 requests in 10 seconds to https://api.example.com/users",
      "Stress test ramping up to 50 RPS over 5 minutes",
      "Load test 200 POST requests with random user data",
      "Endurance test at 10 RPS for 30 minutes",
      "help",
      "history",
      "export last json",
      "clear",
      "exit",
    ];
  }

  private displayHelp(): void {
    console.log(chalk.blue.bold("\n📖 Available Commands:\n"));

    console.log(chalk.green("StressMaster Commands:"));
    console.log("  • Send [N] [METHOD] requests to [URL]");
    console.log("  • Spike test with [N] requests in [TIME]");
    console.log("  • Stress test ramping up to [N] RPS over [TIME]");
    console.log("  • Load test [N] requests with [payload description]");
    console.log("  • Endurance test at [N] RPS for [TIME]");

    console.log(chalk.green("\nSystem Commands:"));
    console.log("  help     - Show this help message");
    console.log("  history  - Show command history");
    console.log("  clear    - Clear the screen");
    console.log("  export   - Export test results");
    console.log("  exit     - Exit the application");

    console.log(chalk.green("\nExamples:"));
    console.log(
      chalk.gray("  Send 100 GET requests to https://api.example.com")
    );
    console.log(chalk.gray("  Spike test with 1000 requests in 10 seconds"));
    console.log(
      chalk.gray("  Load test 50 POST requests with random user IDs")
    );
    console.log();
  }

  private displayHistory(): void {
    const recentHistory = this.history.getHistory().slice(0, 20);

    if (recentHistory.length === 0) {
      console.log(chalk.yellow("No command history available."));
      return;
    }

    console.log(chalk.blue.bold("\n📜 Recent Command History:\n"));

    recentHistory.forEach((entry, index) => {
      const status =
        entry.result === "success" ? chalk.green("✓") : chalk.red("✗");
      const time = entry.timestamp.toLocaleTimeString();
      const duration = `${entry.executionTime}ms`;

      console.log(
        `${status} ${chalk.gray(time)} ${chalk.cyan(duration.padStart(8))} ${
          entry.command
        }`
      );
    });

    console.log();
  }

  private async handleExportCommand(input: string): Promise<void> {
    const parts = input.split(" ");
    if (parts.length < 3) {
      console.log(chalk.yellow("Usage: export [last|all] [json|csv|html]"));
      return;
    }

    const target = parts[1]; // "last" or "all"
    const format = parts[2] as ExportFormat;

    if (!["json", "csv", "html"].includes(format)) {
      console.log(chalk.red("Invalid format. Use: json, csv, or html"));
      return;
    }

    if (target === "last") {
      const lastResult =
        this.session.testHistory[this.session.testHistory.length - 1];
      if (!lastResult) {
        console.log(chalk.yellow("No test results available to export."));
        return;
      }
      await this.exportResults(lastResult, format);
    } else if (target === "all") {
      console.log(chalk.yellow("Exporting all results not yet implemented."));
    } else {
      console.log(chalk.yellow("Usage: export [last|all] [json|csv|html]"));
    }
  }

  private async executeCommand(input: string): Promise<void> {
    const startTime = Date.now();

    try {
      console.log(chalk.blue("🔄 Processing command..."));

      // This would integrate with the actual command processor
      // For now, we'll simulate the process
      const result = await this.processCommand(input);

      const executionTime = Date.now() - startTime;

      this.history.addEntry({
        command: input,
        result: "success",
        executionTime,
      });

      this.session.testHistory.push(result);
      this.displayResults(result);

      await this.saveHistory();
    } catch (error) {
      const executionTime = Date.now() - startTime;

      this.history.addEntry({
        command: input,
        result: "error",
        executionTime,
      });

      console.error(chalk.red(`❌ Command failed: ${error}`));
      await this.saveHistory();
    }
  }

  async processCommand(input: string): Promise<TestResult> {
    // Import the AI components
    const { AICommandParser } = await import("../parser/command-parser");
    const { LoadTestWorkflowOrchestrator } = await import(
      "../orchestrator/load-test-orchestrator"
    );
    const { K6ScriptGenerator } = await import("../generator/script-generator");
    const { K6ScriptExecutor } = await import("../executor/script-executor");

    try {
      // Initialize AI Command Parser (using Ollama by default)
      // Note: Multi-provider support available - see docs/AI_PROVIDERS.md
      const parser = new AICommandParser({
        ollamaEndpoint: process.env.OLLAMA_URL || "http://localhost:11434",
        modelName: process.env.AI_MODEL || "llama3.2:1b",
        maxRetries: 3,
        timeout: 30000,
      });

      console.log(chalk.blue("🤖 Initializing AI parser..."));
      await parser.initialize();

      console.log(chalk.blue("🔍 Parsing natural language command..."));
      const spec = await parser.parseCommand(input);

      console.log(chalk.green("✅ Command parsed successfully!"));
      console.log(chalk.gray(`Test Type: ${spec.testType}`));
      console.log(chalk.gray(`Target: ${spec.requests[0]?.url || "N/A"}`));
      console.log(chalk.gray(`Method: ${spec.requests[0]?.method || "N/A"}`));

      // Generate K6 script and show what would be executed
      console.log(chalk.blue("🔧 Generating K6 script..."));
      const generator = new K6ScriptGenerator();
      const k6Script = generator.generateScript(spec);

      console.log(chalk.green("✅ K6 script generated successfully!"));
      console.log(chalk.yellow("📝 Generated Request Body:"));

      // Extract and show the request body that would be sent
      if (spec.requests[0]?.payload) {
        const payloadTemplate = generator.generatePayloadTemplate(
          spec.requests[0].payload
        );
        let requestBody = spec.requests[0].payload.template;

        // Replace template variables with example values
        payloadTemplate.variables.forEach((variable) => {
          const exampleValue = this.generateExampleValue(variable.type);
          requestBody = requestBody.replace(
            `{{${variable.name}}}`,
            exampleValue
          );
        });

        console.log(chalk.cyan(requestBody));
      }

      console.log(chalk.blue("🚀 Executing real HTTP request..."));

      // Dynamic API request enhancement - detects and enhances various API patterns
      const enhancementResult = this.enhanceApiRequest(spec, input);
      if (enhancementResult.enhanced) {
        console.log(chalk.yellow(`🔧 ${enhancementResult.message}`));
        console.log(chalk.green(`✅ ${enhancementResult.summary}`));
      }

      // Execute real HTTP requests
      const { BasicHttpExecutor } = await import(
        "../executor/simple-http-executor"
      );
      const executor = new BasicHttpExecutor();
      const realResult = await executor.executeLoadTest(spec);

      return realResult;
    } catch (error) {
      console.log(chalk.yellow("⚠️  AI parsing failed, using fallback..."));

      // Extract basic info from the command for fallback execution
      const urlMatch = input.match(/(https?:\/\/[^\s]+)/i);
      const methodMatch = input.match(/(GET|POST|PUT|DELETE|PATCH)/i);
      const requestCountMatch = input.match(
        /(\d+)\s+(?:post|get|put|delete|patch)?\s*requests?/i
      );
      const apiKeyMatch = input.match(/x-api-key\s+([^\s]+)/i);
      const requestIdMatch = input.match(/requestId\s+([^\s,}]+)/i);
      const externalIdMatch = input.match(/externalId\s+([^\s,}]+)/i);

      // Create a fallback spec that can actually execute
      const fallbackSpec: LoadTestSpec = {
        id: `fallback_${Date.now()}`,
        name: "Fallback Test",
        description: input,
        testType: "baseline",
        requests: [
          {
            method: (methodMatch
              ? methodMatch[1].toUpperCase()
              : "POST") as any,
            url: urlMatch ? urlMatch[1] : "https://httpbin.org/post",
            headers: {
              "Content-Type": "application/json",
              ...(apiKeyMatch ? { "x-api-key": apiKeyMatch[1] } : {}),
            },
            ...(requestIdMatch && externalIdMatch
              ? {
                  payload: {
                    template:
                      '{"requestId": "{{requestId}}", "payload": [{"externalId": "{{externalId}}"}]}',
                    variables: [
                      {
                        name: "requestId",
                        type: "incremental" as any,
                        parameters: { baseValue: requestIdMatch[1] },
                      },
                      {
                        name: "externalId",
                        type: "literal" as any,
                        parameters: { literalValue: externalIdMatch[1] },
                      },
                    ],
                  },
                }
              : {}),
          },
        ],
        loadPattern: {
          type: "constant",
          virtualUsers: requestCountMatch ? parseInt(requestCountMatch[1]) : 1,
        },
        duration: { value: 30, unit: "seconds" },
      };

      console.log(chalk.blue("🚀 Executing fallback HTTP requests..."));

      // Execute real HTTP requests even in fallback mode
      const { BasicHttpExecutor } = await import(
        "../executor/simple-http-executor"
      );
      const executor = new BasicHttpExecutor();
      const fallbackResult = await executor.executeLoadTest(fallbackSpec);

      // Add fallback warning to recommendations
      fallbackResult.recommendations.unshift(
        "⚠️  Used fallback parsing - results may be less accurate",
        "🔧 Check Ollama connection for better AI parsing"
      );

      return fallbackResult;
    }
  }

  displayResults(results: TestResult): void {
    this.resultDisplay.displayResults(results);
  }

  async exportResults(
    results: TestResult,
    format: ExportFormat
  ): Promise<void> {
    const exportedData = await this.resultDisplay.exportResults(
      results,
      format
    );
    console.log(
      `Results exported successfully. Data length: ${exportedData.length} characters`
    );
  }

  private async saveHistory(): Promise<void> {
    if (this.config.historyFile) {
      try {
        await this.history.saveToFile(this.config.historyFile);
      } catch (error) {
        if (this.config.verbose) {
          console.warn(
            chalk.yellow(`Warning: Could not save history: ${error}`)
          );
        }
      }
    }
  }

  private generateExampleValue(variableType: string): string {
    switch (variableType) {
      case "random_id":
        return Math.floor(Math.random() * 1000000).toString();
      case "uuid":
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      case "timestamp":
        return Date.now().toString();
      case "random_string":
        return Math.random().toString(36).substring(2, 12);
      case "sequence":
        return "1";
      default:
        return "example_value";
    }
  }

  /**
   * Dynamic API request enhancement system - detects and enhances various API patterns
   */
  private enhanceApiRequest(
    spec: LoadTestSpec,
    input: string
  ): {
    enhanced: boolean;
    message: string;
    summary: string;
  } {
    let enhanced = false;
    const enhancements: string[] = [];
    const messages: string[] = [];

    // 1. Header Enhancement - Detect and add various authentication headers
    const headerEnhancements = this.enhanceHeaders(spec, input);
    if (headerEnhancements.enhanced) {
      enhanced = true;
      enhancements.push(...headerEnhancements.enhancements);
      messages.push(headerEnhancements.message);
    }

    // 2. Payload Enhancement - Detect and structure various payload patterns
    const payloadEnhancements = this.enhancePayload(spec, input);
    if (payloadEnhancements.enhanced) {
      enhanced = true;
      enhancements.push(...payloadEnhancements.enhancements);
      messages.push(payloadEnhancements.message);
    }

    // 3. URL Enhancement - Detect and enhance URL patterns
    const urlEnhancements = this.enhanceUrl(spec, input);
    if (urlEnhancements.enhanced) {
      enhanced = true;
      enhancements.push(...urlEnhancements.enhancements);
      messages.push(urlEnhancements.message);
    }

    // 4. API-Specific Enhancements - Detect known API patterns
    const apiSpecificEnhancements = this.enhanceApiSpecific(spec, input);
    if (apiSpecificEnhancements.enhanced) {
      enhanced = true;
      enhancements.push(...apiSpecificEnhancements.enhancements);
      messages.push(apiSpecificEnhancements.message);
    }

    return {
      enhanced,
      message: messages.join(", "),
      summary: enhancements.join(", "),
    };
  }

  /**
   * Enhance headers - detects various authentication patterns
   */
  private enhanceHeaders(
    spec: LoadTestSpec,
    input: string
  ): {
    enhanced: boolean;
    message: string;
    enhancements: string[];
  } {
    const enhancements: string[] = [];
    let enhanced = false;

    if (!spec.requests[0].headers) {
      spec.requests[0].headers = {};
    }

    // Detect x-api-key pattern
    const apiKeyMatch = input.match(/x-api-key\s+([^\s]+)/i);
    if (apiKeyMatch) {
      spec.requests[0].headers["x-api-key"] = apiKeyMatch[1];
      enhancements.push("x-api-key header");
      enhanced = true;
    }

    // Detect Authorization Bearer pattern
    const bearerMatch = input.match(/(?:authorization|bearer)\s+([^\s]+)/i);
    if (bearerMatch) {
      spec.requests[0].headers["Authorization"] = `Bearer ${bearerMatch[1]}`;
      enhancements.push("Bearer token");
      enhanced = true;
    }

    // Detect Basic Auth pattern
    const basicAuthMatch = input.match(/basic\s+auth\s+([^\s]+):([^\s]+)/i);
    if (basicAuthMatch) {
      const credentials = Buffer.from(
        `${basicAuthMatch[1]}:${basicAuthMatch[2]}`
      ).toString("base64");
      spec.requests[0].headers["Authorization"] = `Basic ${credentials}`;
      enhancements.push("Basic authentication");
      enhanced = true;
    }

    // Detect custom headers pattern
    const customHeaderMatches = input.matchAll(
      /header\s+([^\s]+)\s+([^\s]+)/gi
    );
    for (const match of customHeaderMatches) {
      if (
        !match[1].toLowerCase().includes("x-api-key") &&
        !match[1].toLowerCase().includes("authorization")
      ) {
        spec.requests[0].headers[match[1]] = match[2];
        enhancements.push(`${match[1]} header`);
        enhanced = true;
      }
    }

    // Always ensure Content-Type for POST/PUT/PATCH
    if (
      ["POST", "PUT", "PATCH"].includes(spec.requests[0].method) &&
      !spec.requests[0].headers["Content-Type"]
    ) {
      spec.requests[0].headers["Content-Type"] = "application/json";
      enhancements.push("Content-Type header");
      enhanced = true;
    }

    return {
      enhanced,
      message: enhanced ? "Enhanced request headers" : "",
      enhancements,
    };
  }

  /**
   * Enhance payload - detects various payload patterns
   */
  private enhancePayload(
    spec: LoadTestSpec,
    input: string
  ): {
    enhanced: boolean;
    message: string;
    enhancements: string[];
  } {
    const enhancements: string[] = [];
    let enhanced = false;

    // Only enhance payload for methods that typically have bodies
    if (!["POST", "PUT", "PATCH"].includes(spec.requests[0].method)) {
      return { enhanced: false, message: "", enhancements: [] };
    }

    // Always enhance payload if the input contains "JSON body containing" to ensure all fields are captured
    const hasJsonBodyCommand = input
      .toLowerCase()
      .includes("json body containing");

    // Skip enhancement only if payload already exists and is complete AND contains the payload field AND we're not dealing with a JSON body command
    if (
      !hasJsonBodyCommand &&
      spec.requests[0].payload &&
      spec.requests[0].payload.template &&
      spec.requests[0].payload.template !== "{}" &&
      spec.requests[0].payload.template.includes("payload") &&
      spec.requests[0].payload.variables &&
      spec.requests[0].payload.variables.length > 0
    ) {
      return { enhanced: false, message: "", enhancements: [] };
    }

    // Universal dynamic JSON body parser - handles ANY structure
    const jsonBodyMatch = input.match(/JSON body containing (.+?)(?:\s*$)/i);
    if (jsonBodyMatch) {
      const bodyDescription = jsonBodyMatch[1];
      console.log(chalk.blue(`🔍 Parsing JSON body: "${bodyDescription}"`));

      // Parse all fields dynamically
      let template = "{";
      const variables: any[] = [];
      const extractedFields: string[] = [];

      // First, extract array fields (they contain more complex patterns)
      const arrayMatches = bodyDescription.matchAll(
        /(\w+)\s+(?:as\s+)?array\s+with\s+(.+?)(?=\s*(?:,|and\s+\w+\s+(?!array|with|having|object)|\s*$))/gi
      );
      const arrayFields = new Set<string>();

      for (const match of arrayMatches) {
        const fieldName = match[1];
        const arrayContent = match[2];
        arrayFields.add(fieldName);

        template += `"${fieldName}": [`;

        // Parse array content - look for "one object having fieldName value"
        const objectMatch = arrayContent.match(
          /one\s+object\s+having\s+(\w+)\s+([^\s,]+)/i
        );
        if (objectMatch) {
          const objFieldName = objectMatch[1];
          const objFieldValue = objectMatch[2];

          template += `{"${objFieldName}": "{{${objFieldName}}}"}`;
          variables.push({
            name: objFieldName,
            type: "literal",
            parameters: { literalValue: objFieldValue },
          });
          extractedFields.push(
            `${fieldName}[].${objFieldName}: ${objFieldValue}`
          );
        }

        template += "],";
        extractedFields.push(`${fieldName}: [array]`);
      }

      // Then extract simple fields, being more comprehensive with separators
      // Remove array parts first to avoid conflicts
      let simpleFieldsText = bodyDescription;
      for (const match of bodyDescription.matchAll(
        /(\w+)\s+(?:as\s+)?array\s+with\s+.+?(?=\s*(?:,|and\s+\w+\s+(?!array|with|having|object)|\s*$))/gi
      )) {
        simpleFieldsText = simpleFieldsText.replace(match[0], "");
      }

      // Use multiple comprehensive regex patterns to capture all field-value pairs
      const fieldPatterns = [
        // Pattern 1: field value, field value and field value
        /(\w+)\s+([^\s,]+)(?=\s*(?:,\s*|\s+and\s+|\s*$))/gi,
        // Pattern 2: field value followed by comma or "and"
        /(\w+)\s+([^\s,]+)(?=\s*,)/gi,
        // Pattern 3: field value at end or before "and"
        /(\w+)\s+([^\s,]+)(?=\s+and\s+|\s*$)/gi,
      ];

      const extractedFieldNames = new Set<string>();

      // Apply all patterns to ensure comprehensive extraction
      for (const pattern of fieldPatterns) {
        const matches = simpleFieldsText.matchAll(pattern);
        for (const match of matches) {
          const fieldName = match[1];
          const fieldValue = match[2];

          // Skip common words and already processed array fields, but allow legitimate field names like "type"
          const skipWords = [
            "containing",
            "with",
            "as",
            "having",
            "one",
            "object",
            "array",
            "json",
            "body",
            "send",
            "post",
            "get",
            "put",
            "delete",
            "requests",
            "to",
          ];

          if (
            !skipWords.includes(fieldName.toLowerCase()) &&
            !arrayFields.has(fieldName) &&
            !extractedFieldNames.has(fieldName)
          ) {
            extractedFieldNames.add(fieldName);

            template += `"${fieldName}": "{{${fieldName}}}",`;

            // Determine field type
            let fieldType = "literal";
            if (
              fieldName.toLowerCase().includes("id") &&
              fieldValue.match(/[-\w]*\d+$/)
            ) {
              fieldType = "incremental";
            }

            variables.push({
              name: fieldName,
              type: fieldType,
              parameters:
                fieldType === "incremental"
                  ? { baseValue: fieldValue }
                  : { literalValue: fieldValue },
            });

            extractedFields.push(`${fieldName}: ${fieldValue} (${fieldType})`);
          }
        }
      }

      // Remove trailing comma and close
      if (template.endsWith(",")) {
        template = template.slice(0, -1);
      }
      template += "}";

      console.log(
        chalk.green(`✅ Extracted fields: ${extractedFields.join(", ")}`)
      );
      console.log(chalk.cyan(`📝 Generated template: ${template}`));

      if (variables.length > 0) {
        spec.requests[0].payload = {
          template,
          variables,
        };
        enhancements.push("Universal JSON structure");
        enhanced = true;
      }
    }
    // Detect complete JSON object in the input
    else {
      // First, try to extract a complete JSON object from the input
      const jsonMatch = input.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
      if (jsonMatch) {
        try {
          // Try to parse the JSON to validate it
          const parsedJson = JSON.parse(jsonMatch[0]);

          // Use the complete JSON as the body directly (not as a template)
          spec.requests[0].body = parsedJson;
          enhancements.push("Complete JSON body");
          enhanced = true;
        } catch (error) {
          // If JSON parsing fails, fall back to the old key-value extraction
          console.warn(
            "Failed to parse JSON, falling back to key-value extraction:",
            error
          );

          // Extract key-value pairs from the input (fallback)
          const keyValueMatches = input.matchAll(/(\w+)\s+([^\s,}]+)/g);
          const variables: any[] = [];
          let template = "{";

          for (const match of keyValueMatches) {
            const key = match[1];
            const value = match[2];

            // Skip common words that aren't field names
            if (
              ![
                "send",
                "post",
                "get",
                "put",
                "delete",
                "requests",
                "to",
                "with",
                "header",
                "json",
                "body",
                "containing",
                "key", // Add "key" to skip list to avoid x-api-key interference
              ].includes(key.toLowerCase())
            ) {
              template += `"${key}": "{{${key}}}",`;
              variables.push({
                name: key,
                type: "literal",
                parameters: { literalValue: value },
              });
            }
          }

          if (variables.length > 0) {
            template = template.slice(0, -1) + "}"; // Remove last comma and close
            spec.requests[0].payload = { template, variables };
            enhancements.push("JSON payload structure");
            enhanced = true;
          }
        }
      }
    }

    return {
      enhanced,
      message: enhanced ? "Enhanced request payload" : "",
      enhancements,
    };
  }

  /**
   * Enhance URL - detects and enhances URL patterns
   */
  private enhanceUrl(
    spec: LoadTestSpec,
    input: string
  ): {
    enhanced: boolean;
    message: string;
    enhancements: string[];
  } {
    const enhancements: string[] = [];
    let enhanced = false;

    // Add query parameters if detected
    const queryParamMatches = input.matchAll(
      /(?:param|query)\s+([^\s=]+)=([^\s&]+)/gi
    );
    for (const match of queryParamMatches) {
      const separator = spec.requests[0].url.includes("?") ? "&" : "?";
      spec.requests[0].url += `${separator}${match[1]}=${match[2]}`;
      enhancements.push(`${match[1]} query parameter`);
      enhanced = true;
    }

    return {
      enhanced,
      message: enhanced ? "Enhanced URL parameters" : "",
      enhancements,
    };
  }

  /**
   * API-specific enhancements - detects API patterns and features dynamically
   */
  private enhanceApiSpecific(
    spec: LoadTestSpec,
    input: string
  ): {
    enhanced: boolean;
    message: string;
    enhancements: string[];
  } {
    const enhancements: string[] = [];
    let enhanced = false;
    const url = spec.requests[0].url.toLowerCase();
    const inputLower = input.toLowerCase();

    if (!spec.requests[0].headers) {
      spec.requests[0].headers = {};
    }

    // 1. REST API Pattern Detection
    if (this.isRestApiPattern(url)) {
      // Add standard REST headers if not present
      if (!spec.requests[0].headers["Accept"]) {
        spec.requests[0].headers["Accept"] = "application/json";
        enhancements.push("REST Accept header");
        enhanced = true;
      }

      // Add User-Agent for better API compatibility
      if (!spec.requests[0].headers["User-Agent"]) {
        spec.requests[0].headers["User-Agent"] = "StressMaster/1.0";
        enhancements.push("User-Agent header");
        enhanced = true;
      }
    }

    // 2. Versioned API Detection
    const apiVersion = this.detectApiVersion(url, input);
    if (apiVersion.detected) {
      if (apiVersion.headerName && apiVersion.headerValue) {
        spec.requests[0].headers[apiVersion.headerName] =
          apiVersion.headerValue;
        enhancements.push(`${apiVersion.headerName} header`);
        enhanced = true;
      }
    }

    // 3. GraphQL API Detection
    if (this.isGraphQLApi(url, input)) {
      spec.requests[0].headers["Content-Type"] = "application/json";
      spec.requests[0].headers["Accept"] = "application/json";
      enhancements.push("GraphQL headers");
      enhanced = true;
    }

    // 4. Webhook/Event API Detection
    if (this.isWebhookApi(url, input)) {
      if (!spec.requests[0].headers["Content-Type"]) {
        spec.requests[0].headers["Content-Type"] = "application/json";
      }
      // Add webhook-specific headers
      spec.requests[0].headers["X-Event-Type"] = "load-test";
      enhancements.push("Webhook headers");
      enhanced = true;
    }

    // 5. File Upload API Detection
    if (this.isFileUploadApi(url, input)) {
      // Remove JSON content-type for file uploads
      if (spec.requests[0].headers["Content-Type"] === "application/json") {
        delete spec.requests[0].headers["Content-Type"];
      }
      enhancements.push("File upload optimization");
      enhanced = true;
    }

    // 6. Real-time API Detection (WebSocket, SSE)
    if (this.isRealtimeApi(url, input)) {
      spec.requests[0].headers["Connection"] = "Upgrade";
      spec.requests[0].headers["Upgrade"] = "websocket";
      enhancements.push("Real-time API headers");
      enhanced = true;
    }

    // 7. Microservice Pattern Detection
    if (this.isMicroserviceApi(url)) {
      // Add correlation ID for distributed tracing
      spec.requests[0].headers["X-Correlation-ID"] = "{{correlationId}}";
      // Add request ID for tracking
      spec.requests[0].headers["X-Request-ID"] = "{{requestId}}";
      enhancements.push("Microservice tracing headers");
      enhanced = true;
    }

    // 8. CORS-enabled API Detection
    if (this.requiresCorsHeaders(url, input)) {
      spec.requests[0].headers["Origin"] = "https://load-tester.local";
      spec.requests[0].headers["Access-Control-Request-Method"] =
        spec.requests[0].method;
      enhancements.push("CORS headers");
      enhanced = true;
    }

    return {
      enhanced,
      message: enhanced ? "Applied dynamic API pattern enhancements" : "",
      enhancements,
    };
  }

  /**
   * Detect if URL follows REST API patterns
   */
  private isRestApiPattern(url: string): boolean {
    return (
      url.includes("/api/") ||
      url.includes("/v1/") ||
      url.includes("/v2/") ||
      url.includes("/v3/") ||
      url.includes("/rest/") ||
      /\/api\/v\d+\//.test(url)
    );
  }

  /**
   * Detect API version and determine appropriate headers
   */
  private detectApiVersion(
    url: string,
    input: string
  ): {
    detected: boolean;
    headerName?: string;
    headerValue?: string;
  } {
    // Check for version in URL path
    const urlVersionMatch = url.match(/\/v(\d+)(?:\.(\d+))?/);
    if (urlVersionMatch) {
      const version = urlVersionMatch[2]
        ? `${urlVersionMatch[1]}.${urlVersionMatch[2]}`
        : urlVersionMatch[1];

      // Determine header based on common patterns
      if (url.includes("stripe")) {
        return {
          detected: true,
          headerName: "Stripe-Version",
          headerValue: `2023-10-16`,
        };
      } else if (url.includes("github")) {
        return {
          detected: true,
          headerName: "Accept",
          headerValue: `application/vnd.github.v${version}+json`,
        };
      } else {
        return {
          detected: true,
          headerName: "API-Version",
          headerValue: version,
        };
      }
    }

    // Check for version in input command
    const inputVersionMatch = input.match(/version\s+([^\s]+)/i);
    if (inputVersionMatch) {
      return {
        detected: true,
        headerName: "API-Version",
        headerValue: inputVersionMatch[1],
      };
    }

    return { detected: false };
  }

  /**
   * Detect GraphQL API patterns
   */
  private isGraphQLApi(url: string, input: string): boolean {
    return (
      url.includes("/graphql") ||
      url.includes("/gql") ||
      input.toLowerCase().includes("graphql") ||
      input.toLowerCase().includes("query") ||
      input.toLowerCase().includes("mutation")
    );
  }

  /**
   * Detect webhook/event API patterns
   */
  private isWebhookApi(url: string, input: string): boolean {
    return (
      url.includes("/webhook") ||
      url.includes("/hook") ||
      url.includes("/event") ||
      url.includes("/notify") ||
      input.toLowerCase().includes("webhook") ||
      input.toLowerCase().includes("event")
    );
  }

  /**
   * Detect file upload API patterns
   */
  private isFileUploadApi(url: string, input: string): boolean {
    return (
      url.includes("/upload") ||
      url.includes("/file") ||
      url.includes("/media") ||
      url.includes("/attachment") ||
      input.toLowerCase().includes("upload") ||
      input.toLowerCase().includes("file")
    );
  }

  /**
   * Detect real-time API patterns
   */
  private isRealtimeApi(url: string, input: string): boolean {
    return (
      url.includes("ws://") ||
      url.includes("wss://") ||
      url.includes("/socket") ||
      url.includes("/realtime") ||
      url.includes("/live") ||
      input.toLowerCase().includes("websocket") ||
      input.toLowerCase().includes("realtime")
    );
  }

  /**
   * Universal JSON body parser - handles ANY structure from natural language
   */
  private parseUniversalJsonBody(bodyDescription: string): {
    template: string;
    variables: any[];
  } {
    const variables: any[] = [];
    let template = "{";

    // Split by common separators and parse each field
    const parts = bodyDescription.split(/\s+and\s+|\s*,\s*/);

    for (const part of parts) {
      const trimmedPart = part.trim();

      // Pattern 1: "fieldName value" (simple field)
      const simpleFieldMatch = trimmedPart.match(/^(\w+)\s+([^\s]+)$/);
      if (simpleFieldMatch) {
        const fieldName = simpleFieldMatch[1];
        const fieldValue = simpleFieldMatch[2];

        // Skip common words
        if (
          !["containing", "with", "and", "as", "having"].includes(
            fieldName.toLowerCase()
          )
        ) {
          template += `"${fieldName}": "{{${fieldName}}}",`;

          // Determine field type
          let fieldType = "literal";
          if (
            fieldName.toLowerCase().includes("id") &&
            fieldValue.match(/\d+$/)
          ) {
            fieldType = "incremental";
          }

          variables.push({
            name: fieldName,
            type: fieldType,
            parameters:
              fieldType === "incremental"
                ? { baseValue: fieldValue }
                : { literalValue: fieldValue },
          });
        }
      }

      // Pattern 2: "fieldName as array with..." (array field)
      const arrayFieldMatch = trimmedPart.match(
        /^(\w+)\s+as\s+array\s+with\s+(.+)$/i
      );
      if (arrayFieldMatch) {
        const fieldName = arrayFieldMatch[1];
        const arrayContent = arrayFieldMatch[2];

        template += `"${fieldName}": [{{${fieldName}_content}}],`;

        // Parse array content
        const arrayTemplate = this.parseArrayContent(arrayContent);
        variables.push({
          name: `${fieldName}_content`,
          type: "literal",
          parameters: { literalValue: arrayTemplate },
        });
      }

      // Pattern 3: "fieldName array with..." (alternative array syntax)
      const arrayFieldMatch2 = trimmedPart.match(
        /^(\w+)\s+array\s+with\s+(.+)$/i
      );
      if (arrayFieldMatch2) {
        const fieldName = arrayFieldMatch2[1];
        const arrayContent = arrayFieldMatch2[2];

        template += `"${fieldName}": [{{${fieldName}_content}}],`;

        const arrayTemplate = this.parseArrayContent(arrayContent);
        variables.push({
          name: `${fieldName}_content`,
          type: "literal",
          parameters: { literalValue: arrayTemplate },
        });
      }
    }

    // Remove trailing comma and close template
    if (template.endsWith(",")) {
      template = template.slice(0, -1);
    }
    template += "}";

    return { template, variables };
  }

  /**
   * Parse array content from natural language description
   */
  private parseArrayContent(arrayDescription: string): string {
    const desc = arrayDescription.toLowerCase().trim();

    // Pattern 1: "one object having fieldName value"
    const objectMatch = arrayDescription.match(/one\s+object\s+having\s+(.+)/i);
    if (objectMatch) {
      const objectFields = objectMatch[1];
      let objectTemplate = "{";

      // Parse object fields
      const fieldMatches = objectFields.matchAll(/(\w+)\s+([^\s,]+)/g);
      for (const match of fieldMatches) {
        const fieldName = match[1];
        const fieldValue = match[2];

        if (!["having", "and", "with"].includes(fieldName.toLowerCase())) {
          objectTemplate += `"${fieldName}": "${fieldValue}",`;
        }
      }

      if (objectTemplate.endsWith(",")) {
        objectTemplate = objectTemplate.slice(0, -1);
      }
      objectTemplate += "}";

      return objectTemplate;
    }

    // Pattern 2: "objects with fieldName value"
    const objectsMatch = arrayDescription.match(/objects?\s+with\s+(.+)/i);
    if (objectsMatch) {
      const objectFields = objectsMatch[1];
      let objectTemplate = "{";

      const fieldMatches = objectFields.matchAll(/(\w+)\s+([^\s,]+)/g);
      for (const match of fieldMatches) {
        const fieldName = match[1];
        const fieldValue = match[2];

        if (!["with", "and", "having"].includes(fieldName.toLowerCase())) {
          objectTemplate += `"${fieldName}": "${fieldValue}",`;
        }
      }

      if (objectTemplate.endsWith(",")) {
        objectTemplate = objectTemplate.slice(0, -1);
      }
      objectTemplate += "}";

      return objectTemplate;
    }

    // Pattern 3: Simple values (strings, numbers)
    if (desc.includes("string") || desc.includes("text")) {
      return '"string_value"';
    }
    if (desc.includes("number") || desc.includes("integer")) {
      return "123";
    }

    // Default: treat as simple object with the description as a field
    return `{"value": "${arrayDescription}"}`;
  }

  /**

  /**
   * Detect microservice API patterns
   */
  private isMicroserviceApi(url: string): boolean {
    // Look for microservice naming patterns
    const microservicePatterns = [
      /\/[a-z]+-service\//,
      /\/[a-z]+\.service\./,
      /\/services\/[a-z]+/,
      /\/ms-[a-z]+/,
      /\/microservice/,
    ];

    return microservicePatterns.some((pattern) => pattern.test(url));
  }

  /**
   * Detect if API requires CORS headers
   */
  private requiresCorsHeaders(url: string, input: string): boolean {
    return (
      input.toLowerCase().includes("cors") ||
      input.toLowerCase().includes("cross-origin") ||
      // APIs that commonly require CORS
      (url.includes("api.") && !url.includes("localhost"))
    );
  }

  async shutdown(): Promise<void> {
    this.isRunning = false;

    console.log(chalk.blue("\n👋 Saving session data..."));
    await this.saveHistory();

    console.log(chalk.green("✅ Session saved successfully"));
    console.log(chalk.blue("Thank you for using StressMaster!"));

    process.exit(0);
  }
}
