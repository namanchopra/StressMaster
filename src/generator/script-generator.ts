import {
  LoadTestSpec,
  PayloadSpec,
  ValidationResult,
  K6Script,
  K6Options,
  ScriptMetadata,
  RequestSpec,
  LoadPattern,
  VariableDefinition,
  HttpMethod,
  Duration,
} from "../types";
import { K6LoadPatternGenerator } from "./load-pattern-generator";

export interface ScriptGenerator {
  generateScript(spec: LoadTestSpec): K6Script;
  generatePayloadTemplate(payloadSpec: PayloadSpec): PayloadTemplate;
  validateScript(script: K6Script): ValidationResult;
}

export interface PayloadTemplate {
  template: string;
  variables: TemplateVariable[];
  generators: Record<string, VariableGenerator>;
}

export interface TemplateVariable {
  name: string;
  placeholder: string;
  type: string;
  required: boolean;
}

export interface VariableGenerator {
  type: string;
  config: Record<string, any>;
  generate(): any;
}

export interface ScriptTemplate {
  name: string;
  description: string;
  template: string;
  requiredVariables: string[];
  optionalVariables: string[];
}

export class K6ScriptGenerator implements ScriptGenerator {
  private templates: Map<string, ScriptTemplate> = new Map();
  private variableGenerators: Map<string, VariableGenerator> = new Map();

  constructor() {
    this.initializeTemplates();
    this.initializeVariableGenerators();
  }

  generateScript(spec: LoadTestSpec): K6Script {
    const template = this.selectTemplate(spec);
    const options = this.generateK6Options(spec.loadPattern, spec.duration);
    const imports = this.generateImports(spec);

    // Generate the main script content
    let scriptContent = template.template;

    // Replace template variables
    scriptContent = this.substituteVariables(scriptContent, spec);

    // Generate request functions (for simple requests) or workflow functions (for complex scenarios)
    if (spec.workflow && spec.workflow.length > 0) {
      const workflowFunctions = this.generateWorkflowFunctions(spec);
      scriptContent = scriptContent.replace(
        "{{REQUEST_FUNCTIONS}}",
        workflowFunctions
      );

      const workflowMainFunction = this.generateWorkflowMainFunction(spec);
      scriptContent = scriptContent.replace(
        "{{MAIN_FUNCTION}}",
        workflowMainFunction
      );
    } else {
      const requestFunctions = this.generateRequestFunctions(spec.requests);
      scriptContent = scriptContent.replace(
        "{{REQUEST_FUNCTIONS}}",
        requestFunctions
      );

      // Generate main test function
      const mainFunction = this.generateMainFunction(spec);
      scriptContent = scriptContent.replace("{{MAIN_FUNCTION}}", mainFunction);
    }

    return {
      id: `script_${spec.id}`,
      name: `${spec.name}_script`,
      content: scriptContent,
      imports,
      options,
      metadata: {
        generatedAt: new Date(),
        specId: spec.id,
        version: "1.0.0",
        description: spec.description,
        tags: [spec.testType],
      },
    };
  }

  generatePayloadTemplate(payloadSpec: PayloadSpec): PayloadTemplate {
    const variables: TemplateVariable[] = [];
    const generators: Record<string, VariableGenerator> = {};

    payloadSpec.variables.forEach((varDef) => {
      const placeholder = `{{${varDef.name}}}`;
      variables.push({
        name: varDef.name,
        placeholder,
        type: varDef.type,
        required: true,
      });

      const generator = this.createVariableGenerator(varDef);
      generators[varDef.name] = generator;
    });

    return {
      template: payloadSpec.template,
      variables,
      generators,
    };
  }

  validateScript(script: K6Script): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic syntax validation
    if (!script.content.includes("export default function")) {
      errors.push("Script must contain a default export function");
    }

    if (!script.content.includes("import http from")) {
      warnings.push("Script should import http module for HTTP requests");
    }

    // Validate K6 options
    if (script.options.vus !== undefined && script.options.vus < 1) {
      errors.push("Virtual users must be at least 1");
    }

    if (
      script.options.duration &&
      !this.isValidDuration(script.options.duration)
    ) {
      errors.push("Invalid duration format");
    }

    // Check for common K6 patterns
    if (!script.content.includes("check(")) {
      warnings.push("Consider adding checks for response validation");
    }

    // Validate JavaScript syntax (basic check)
    try {
      // Simple syntax check - look for balanced braces
      const openBraces = (script.content.match(/{/g) || []).length;
      const closeBraces = (script.content.match(/}/g) || []).length;
      if (openBraces !== closeBraces) {
        errors.push("Unbalanced braces in script");
      }
    } catch (error) {
      errors.push(`Syntax error: ${error}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private initializeTemplates(): void {
    // Basic HTTP request template
    this.templates.set("basic_http", {
      name: "Basic HTTP Request",
      description: "Simple HTTP request template",
      template: `import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

{{REQUEST_FUNCTIONS}}

export default function () {
{{MAIN_FUNCTION}}
}`,
      requiredVariables: ["REQUEST_FUNCTIONS", "MAIN_FUNCTION"],
      optionalVariables: [],
    });

    // Load testing template with stages
    this.templates.set("load_test", {
      name: "Load Test with Stages",
      description: "Template for load testing with ramp-up stages",
      template: `import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');

{{REQUEST_FUNCTIONS}}

export default function () {
{{MAIN_FUNCTION}}
}

export function setup() {
  console.log('Starting load test setup...');
  return {};
}

export function teardown(data) {
  console.log('Load test completed');
}`,
      requiredVariables: ["REQUEST_FUNCTIONS", "MAIN_FUNCTION"],
      optionalVariables: [],
    });
  }

  private initializeVariableGenerators(): void {
    this.variableGenerators.set("random_id", {
      type: "random_id",
      config: {},
      generate: () => Math.floor(Math.random() * 1000000),
    });

    this.variableGenerators.set("uuid", {
      type: "uuid",
      config: {},
      generate: () =>
        "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        }),
    });

    this.variableGenerators.set("timestamp", {
      type: "timestamp",
      config: {},
      generate: () => Date.now(),
    });

    this.variableGenerators.set("random_string", {
      type: "random_string",
      config: { length: 10 },
      generate: () => Math.random().toString(36).substring(2, 12),
    });

    this.variableGenerators.set("sequence", {
      type: "sequence",
      config: { start: 1, step: 1 },
      generate: (() => {
        let counter = 1;
        return () => counter++;
      })(),
    });
  }

  private selectTemplate(spec: LoadTestSpec): ScriptTemplate {
    // Select template based on test type and complexity
    if (spec.loadPattern.type === "ramp-up" || spec.loadPattern.stages) {
      return this.templates.get("load_test")!;
    }
    return this.templates.get("basic_http")!;
  }

  private generateK6Options(
    loadPattern: LoadPattern,
    duration: Duration
  ): K6Options {
    const options: K6Options = {};
    const patternGenerator = new K6LoadPatternGenerator();

    // Use load pattern generator for complex stage generation
    if (loadPattern.type !== "constant" || loadPattern.stages) {
      const stages = patternGenerator.generateK6Stages(loadPattern);
      if (stages.length > 0) {
        options.stages = stages;
      }
    } else {
      // Simple constant load
      if (loadPattern.virtualUsers) {
        options.vus = loadPattern.virtualUsers;
      }

      if (duration) {
        options.duration = this.formatDuration(duration);
      }
    }

    // Add RPS if specified
    if (loadPattern.requestsPerSecond) {
      options.rps = loadPattern.requestsPerSecond;
    }

    // Add default thresholds
    options.thresholds = {
      http_req_duration: ["p(95)<500"],
      http_req_failed: ["rate<0.1"],
      errors: ["rate<0.1"],
    };

    return options;
  }

  private generateImports(spec: LoadTestSpec): string[] {
    const imports = [
      "import http from 'k6/http';",
      "import { check, sleep } from 'k6';",
      "import { Rate, Trend } from 'k6/metrics';",
    ];

    // Add additional imports based on spec requirements
    if (spec.requests.some((req) => req.payload)) {
      // No additional imports needed for basic payloads
    }

    return imports;
  }

  private generateRequestFunctions(requests: RequestSpec[]): string {
    return requests
      .map((request, index) => {
        const functionName = `makeRequest${index + 1}`;
        const method = request.method.toLowerCase();

        let payloadCode = "";
        if (request.payload) {
          payloadCode = this.generatePayloadCode(request.payload);
        }

        let headersCode = "";
        if (request.headers) {
          headersCode = `
    const headers = ${JSON.stringify(request.headers, null, 4)};`;
        }

        let validationCode = "";
        if (request.validation && request.validation.length > 0) {
          validationCode = this.generateValidationCode(request.validation);
        }

        return `
function ${functionName}() {${headersCode}${payloadCode}
    
    const response = http.${method}('${request.url}'${
          request.payload ? ", payload" : ""
        }${request.headers ? ", { headers }" : ""});
    
    ${validationCode}
    
    errorRate.add(response.status !== 200);
    responseTime.add(response.timings.duration);
    
    return response;
}`;
      })
      .join("\n");
  }

  private generatePayloadCode(payloadSpec: PayloadSpec): string {
    const payloadTemplate = this.generatePayloadTemplate(payloadSpec);

    let generatorCode = "";
    Object.entries(payloadTemplate.generators).forEach(([name, generator]) => {
      generatorCode += `
    const ${name} = ${this.generateVariableCode(generator)};`;
    });

    let templateCode = payloadSpec.template;
    payloadTemplate.variables.forEach((variable) => {
      templateCode = templateCode.replace(
        variable.placeholder,
        `\${${variable.name}}`
      );
    });

    return `${generatorCode}
    
    const payload = \`${templateCode}\`;`;
  }

  private generateVariableCode(generator: VariableGenerator): string {
    switch (generator.type) {
      case "random_id":
        return "Math.floor(Math.random() * 1000000)";
      case "uuid":
        return `'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        })`;
      case "timestamp":
        return "Date.now()";
      case "random_string":
        const length = generator.config.length || 10;
        return `Math.random().toString(36).substring(2, ${length + 2})`;
      case "sequence":
        return `(__VU - 1) * __ITER + __ITER`;
      default:
        return "null";
    }
  }

  private generateValidationCode(validations: any[]): string {
    const checks = validations
      .map((validation) => {
        switch (validation.type) {
          case "status_code":
            return `'status is ${validation.expectedValue}': (r) => r.status === ${validation.expectedValue}`;
          case "response_time":
            return `'response time < ${validation.expectedValue}ms': (r) => r.timings.duration < ${validation.expectedValue}`;
          case "content":
            return `'response contains "${validation.expectedValue}"': (r) => r.body.includes('${validation.expectedValue}')`;
          default:
            return `'validation passed': (r) => true`;
        }
      })
      .join(",\n        ");

    return `
    check(response, {
        ${checks}
    });`;
  }

  private generateMainFunction(spec: LoadTestSpec): string {
    const requestCalls = spec.requests
      .map((_, index) => `    makeRequest${index + 1}();`)
      .join("\n");

    return `${requestCalls}
    
    sleep(1);`;
  }

  private createVariableGenerator(
    varDef: VariableDefinition
  ): VariableGenerator {
    const baseGenerator = this.variableGenerators.get(varDef.type);
    if (!baseGenerator) {
      throw new Error(`Unknown variable type: ${varDef.type}`);
    }

    return {
      ...baseGenerator,
      config: { ...baseGenerator.config, ...varDef.parameters },
    };
  }

  private formatDuration(duration: Duration): string {
    const unit =
      duration.unit === "seconds"
        ? "s"
        : duration.unit === "minutes"
        ? "m"
        : "h";
    return `${duration.value}${unit}`;
  }

  private isValidDuration(duration: string): boolean {
    return /^\d+[smh]$/.test(duration);
  }

  private substituteVariables(
    scriptContent: string,
    spec: LoadTestSpec
  ): string {
    // This method can be used for any additional template variable substitution
    // Currently, the main substitutions are handled in generateScript method
    return scriptContent;
  }

  private generateWorkflowFunctions(spec: LoadTestSpec): string {
    if (!spec.workflow || spec.workflow.length === 0) {
      return "";
    }

    // Generate shared data storage for correlation
    let sharedDataCode = `
// Shared data storage for workflow correlation
let workflowData = {};`;

    // Generate individual step functions
    const stepFunctions = spec.workflow
      .map((step, index) => {
        const functionName = `executeStep_${step.id}`;
        const method = step.request.method.toLowerCase();

        let payloadCode = "";
        if (step.request.payload) {
          payloadCode = this.generateWorkflowPayloadCode(
            step.request.payload,
            spec.dataCorrelation || []
          );
        }

        let headersCode = "";
        if (step.request.headers) {
          headersCode = this.generateWorkflowHeadersCode(
            step.request.headers,
            spec.dataCorrelation || []
          );
        }

        let validationCode = "";
        if (step.request.validation && step.request.validation.length > 0) {
          validationCode = this.generateValidationCode(step.request.validation);
        }

        let dataExtractionCode = "";
        if (step.dataExtraction && step.dataExtraction.length > 0) {
          dataExtractionCode = this.generateDataExtractionCode(
            step.dataExtraction
          );
        }

        let conditionCode = "";
        if (step.conditions && step.conditions.length > 0) {
          conditionCode = this.generateStepConditionCode(step.conditions);
        }

        let thinkTimeCode = "";
        if (step.thinkTime) {
          const thinkTimeSeconds = this.convertDurationToSeconds(
            step.thinkTime
          );
          thinkTimeCode = `
    // Think time for realistic user behavior
    sleep(${thinkTimeSeconds});`;
        }

        return `
function ${functionName}() {
    console.log('Executing step: ${step.name}');${headersCode}${payloadCode}
    
    const response = http.${method}('${step.request.url}'${
          step.request.payload ? ", payload" : ""
        }${step.request.headers ? ", { headers }" : ""});
    
    ${validationCode}${dataExtractionCode}${conditionCode}
    
    errorRate.add(response.status < 200 || response.status >= 300);
    responseTime.add(response.timings.duration);${thinkTimeCode}
    
    return response;
}`;
      })
      .join("\n");

    return sharedDataCode + stepFunctions;
  }

  private generateWorkflowMainFunction(spec: LoadTestSpec): string {
    if (!spec.workflow || spec.workflow.length === 0) {
      return "sleep(1);";
    }

    const stepCalls = spec.workflow
      .map((step) => {
        return `    const ${step.id}_response = executeStep_${step.id}();
    
    // Check for step failure conditions
    if (${step.id}_response.status < 200 || ${step.id}_response.status >= 300) {
        console.error('Step ${step.name} failed with status:', ${step.id}_response.status);
        // Continue with workflow or fail based on configuration
    }`;
      })
      .join("\n\n");

    return `    // Execute workflow steps in sequence
${stepCalls}
    
    // Final sleep before next iteration
    sleep(1);`;
  }

  private generateWorkflowPayloadCode(
    payloadSpec: PayloadSpec,
    correlationRules: any[]
  ): string {
    const payloadTemplate = this.generatePayloadTemplate(payloadSpec);

    let generatorCode = "";
    Object.entries(payloadTemplate.generators).forEach(([name, generator]) => {
      generatorCode += `
    const ${name} = ${this.generateVariableCode(generator)};`;
    });

    // Apply data correlation for payload
    let correlationCode = "";
    correlationRules.forEach((rule) => {
      if (payloadSpec.template.includes(`{{${rule.targetField}}}`)) {
        correlationCode += `
    const ${rule.targetField} = workflowData['${rule.sourceStep}_${rule.sourceField}'] || 'default_value';`;
      }
    });

    let templateCode = payloadSpec.template;
    payloadTemplate.variables.forEach((variable) => {
      templateCode = templateCode.replace(
        variable.placeholder,
        `\${${variable.name}}`
      );
    });

    // Replace correlation placeholders
    correlationRules.forEach((rule) => {
      templateCode = templateCode.replace(
        `{{${rule.targetField}}}`,
        `\${${rule.targetField}}`
      );
    });

    return `${generatorCode}${correlationCode}
    
    const payload = \`${templateCode}\`;`;
  }

  private generateWorkflowHeadersCode(
    headers: Record<string, string>,
    correlationRules: any[]
  ): string {
    let headersObj = { ...headers };

    // Apply correlation to headers
    correlationRules.forEach((rule) => {
      Object.keys(headersObj).forEach((headerKey) => {
        if (headersObj[headerKey].includes(`{{${rule.targetField}}}`)) {
          headersObj[headerKey] = headersObj[headerKey].replace(
            `{{${rule.targetField}}}`,
            `\${workflowData['${rule.sourceStep}_${rule.sourceField}'] || 'default_value'}`
          );
        }
      });
    });

    return `
    const headers = ${JSON.stringify(headersObj, null, 4).replace(
      /"\\$\{([^}]+)\}"/g,
      "${$1}"
    )};`;
  }

  private generateDataExtractionCode(extractions: any[]): string {
    const extractionCode = extractions
      .map((extraction) => {
        switch (extraction.extractor) {
          case "json_path":
            return `
    // Extract ${extraction.name} using JSON path
    try {
        const responseJson = JSON.parse(response.body);
        workflowData['${
          extraction.name
        }'] = responseJson${extraction.expression.replace("$.", ".")};
    } catch (e) {
        console.warn('Failed to extract ${extraction.name}:', e.message);
    }`;
          case "regex":
            return `
    // Extract ${extraction.name} using regex
    const ${extraction.name}Match = response.body.match(/${extraction.expression}/);
    if (${extraction.name}Match) {
        workflowData['${extraction.name}'] = ${extraction.name}Match[1] || ${extraction.name}Match[0];
    }`;
          case "xpath":
            return `
    // Extract ${extraction.name} using XPath (basic implementation)
    // Note: K6 doesn't have native XPath support, this is a simplified version
    console.warn('XPath extraction not fully supported in K6, using regex fallback');
    const ${
      extraction.name
    }XPathMatch = response.body.match(/${extraction.expression.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&"
            )}/);
    if (${extraction.name}XPathMatch) {
        workflowData['${extraction.name}'] = ${extraction.name}XPathMatch[0];
    }`;
          default:
            return `
    // Unknown extractor type for ${extraction.name}
    console.warn('Unknown extractor type: ${extraction.extractor}');`;
        }
      })
      .join("\n");

    return extractionCode;
  }

  private generateStepConditionCode(conditions: any[]): string {
    const conditionChecks = conditions
      .map((condition) => {
        let conditionExpression = "";

        switch (condition.type) {
          case "response_code":
            conditionExpression = `response.status ${this.getOperatorSymbol(
              condition.operator
            )} ${condition.value}`;
            break;
          case "response_content":
            if (condition.operator === "contains") {
              conditionExpression = `response.body.includes('${condition.value}')`;
            } else {
              conditionExpression = `response.body ${this.getOperatorSymbol(
                condition.operator
              )} '${condition.value}'`;
            }
            break;
          case "response_time":
            conditionExpression = `response.timings.duration ${this.getOperatorSymbol(
              condition.operator
            )} ${condition.value}`;
            break;
          default:
            conditionExpression = "true";
        }

        let actionCode = "";
        switch (condition.action) {
          case "continue":
            actionCode = "// Continue with next step";
            break;
          case "skip":
            actionCode = "return response; // Skip remaining steps";
            break;
          case "fail":
            actionCode =
              "throw new Error(`Step condition failed: ${condition.type} ${condition.operator} ${condition.value}`);";
            break;
        }

        return `
    // Condition: ${condition.type} ${condition.operator} ${condition.value}
    if (${conditionExpression}) {
        ${actionCode}
    }`;
      })
      .join("\n");

    return conditionChecks;
  }

  private getOperatorSymbol(operator: string): string {
    switch (operator) {
      case "equals":
        return "===";
      case "not_equals":
        return "!==";
      case "greater_than":
        return ">";
      case "less_than":
        return "<";
      case "contains":
        return "includes";
      default:
        return "===";
    }
  }

  private convertDurationToSeconds(duration: Duration): number {
    switch (duration.unit) {
      case "seconds":
        return duration.value;
      case "minutes":
        return duration.value * 60;
      case "hours":
        return duration.value * 3600;
      default:
        return duration.value;
    }
  }
}
