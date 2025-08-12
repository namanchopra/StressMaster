import { LoadTestSpec, RequestSpec, LoadPattern, PayloadSpec } from "../types";
import { ValidationResult } from "../types/common";

export interface ValidationContext {
  originalInput: string;
  confidence: number;
  ambiguities: string[];
}

export interface ValidationRule {
  name: string;
  validate: (
    spec: LoadTestSpec,
    context: ValidationContext
  ) => ValidationIssue[];
}

export interface ValidationIssue {
  type: "error" | "warning" | "suggestion";
  field: string;
  message: string;
  suggestion?: string;
  severity: "critical" | "high" | "medium" | "low";
}

export interface EnhancedValidationResult extends ValidationResult {
  issues: ValidationIssue[];
  suggestions: string[];
  canProceed: boolean;
  confidence: number;
}

export class CommandValidator {
  private static readonly VALIDATION_RULES: ValidationRule[] = [
    {
      name: "required-fields",
      validate: CommandValidator.validateRequiredFields,
    },
    {
      name: "url-format",
      validate: CommandValidator.validateUrlFormat,
    },
    {
      name: "load-parameters",
      validate: CommandValidator.validateLoadParameters,
    },
    {
      name: "payload-structure",
      validate: CommandValidator.validatePayloadStructure,
    },
    {
      name: "duration-validity",
      validate: CommandValidator.validateDuration,
    },
    {
      name: "test-type-consistency",
      validate: CommandValidator.validateTestTypeConsistency,
    },
    {
      name: "workflow-integrity",
      validate: CommandValidator.validateWorkflowIntegrity,
    },
  ];

  static validateLoadTestSpec(
    spec: LoadTestSpec,
    context: ValidationContext
  ): EnhancedValidationResult {
    const issues: ValidationIssue[] = [];

    // Run all validation rules
    for (const rule of this.VALIDATION_RULES) {
      const ruleIssues = rule.validate(spec, context);
      issues.push(...ruleIssues);
    }

    // Categorize issues
    const errors = issues.filter((issue) => issue.type === "error");
    const warnings = issues.filter((issue) => issue.type === "warning");
    const suggestions = issues.filter((issue) => issue.type === "suggestion");

    // Generate actionable suggestions
    const actionableSuggestions = this.generateActionableSuggestions(
      issues,
      context
    );

    // Determine if we can proceed
    const criticalErrors = errors.filter(
      (error) => error.severity === "critical"
    );
    const canProceed = criticalErrors.length === 0;

    // Adjust confidence based on issues
    let adjustedConfidence = context.confidence;
    adjustedConfidence -= errors.length * 0.2;
    adjustedConfidence -= warnings.length * 0.1;
    adjustedConfidence = Math.max(0, Math.min(1, adjustedConfidence));

    return {
      isValid: errors.length === 0,
      errors: errors.map((e) => e.message),
      warnings: warnings.map((w) => w.message),
      issues,
      suggestions: actionableSuggestions,
      canProceed,
      confidence: adjustedConfidence,
    };
  }

  private static validateRequiredFields(
    spec: LoadTestSpec,
    context: ValidationContext
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!spec.id) {
      issues.push({
        type: "error",
        field: "id",
        message: "Test ID is required",
        severity: "critical",
        suggestion: "A unique test ID will be generated automatically",
      });
    }

    if (!spec.name || spec.name.trim() === "") {
      issues.push({
        type: "error",
        field: "name",
        message: "Test name is required",
        severity: "high",
        suggestion: "Provide a descriptive name for your load test",
      });
    }

    if (!spec.requests || spec.requests.length === 0) {
      issues.push({
        type: "error",
        field: "requests",
        message: "At least one request specification is required",
        severity: "critical",
        suggestion: "Specify the API endpoint and HTTP method you want to test",
      });
    }

    return issues;
  }

  private static validateUrlFormat(
    spec: LoadTestSpec,
    context: ValidationContext
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    spec.requests?.forEach((request, index) => {
      if (!request.url) {
        issues.push({
          type: "error",
          field: `requests[${index}].url`,
          message: `Request ${index + 1}: URL is required`,
          severity: "critical",
          suggestion:
            "Provide the complete API endpoint URL (e.g., https://api.example.com/endpoint)",
        });
        return;
      }

      // Check URL format
      if (!CommandValidator.isValidUrl(request.url)) {
        issues.push({
          type: "warning",
          field: `requests[${index}].url`,
          message: `Request ${index + 1}: URL format may be invalid`,
          severity: "medium",
          suggestion:
            "Ensure URL is complete with protocol (https://) or starts with /",
        });
      }

      // Check for placeholder URLs
      if (
        request.url.includes("example.com") ||
        request.url === "/api/endpoint"
      ) {
        issues.push({
          type: "warning",
          field: `requests[${index}].url`,
          message: `Request ${index + 1}: URL appears to be a placeholder`,
          severity: "high",
          suggestion: "Replace with your actual API endpoint URL",
        });
      }

      // Check for missing HTTP method
      if (!request.method) {
        issues.push({
          type: "error",
          field: `requests[${index}].method`,
          message: `Request ${index + 1}: HTTP method is required`,
          severity: "critical",
          suggestion: "Specify the HTTP method (GET, POST, PUT, DELETE, etc.)",
        });
      }
    });

    return issues;
  }

  private static validateLoadParameters(
    spec: LoadTestSpec,
    context: ValidationContext
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!spec.loadPattern) {
      issues.push({
        type: "error",
        field: "loadPattern",
        message: "Load pattern is required",
        severity: "critical",
        suggestion:
          "Specify load parameters like virtual users or requests per second",
      });
      return issues;
    }

    const { loadPattern } = spec;

    // Check if either virtualUsers or requestsPerSecond is specified
    if (!loadPattern.virtualUsers && !loadPattern.requestsPerSecond) {
      issues.push({
        type: "error",
        field: "loadPattern",
        message:
          "Either virtual users or requests per second must be specified",
        severity: "critical",
        suggestion:
          'Add "virtualUsers" or "requestsPerSecond" to your load pattern',
      });
    }

    // Validate virtual users
    if (loadPattern.virtualUsers !== undefined) {
      if (loadPattern.virtualUsers <= 0) {
        issues.push({
          type: "error",
          field: "loadPattern.virtualUsers",
          message: "Virtual users must be greater than 0",
          severity: "high",
          suggestion:
            "Set a positive number of virtual users (e.g., 10, 50, 100)",
        });
      } else if (loadPattern.virtualUsers > 10000) {
        issues.push({
          type: "warning",
          field: "loadPattern.virtualUsers",
          message:
            "Very high number of virtual users may cause resource issues",
          severity: "medium",
          suggestion: "Consider starting with a smaller number and scaling up",
        });
      }
    }

    // Validate requests per second
    if (loadPattern.requestsPerSecond !== undefined) {
      if (loadPattern.requestsPerSecond <= 0) {
        issues.push({
          type: "error",
          field: "loadPattern.requestsPerSecond",
          message: "Requests per second must be greater than 0",
          severity: "high",
          suggestion: "Set a positive RPS value (e.g., 10, 50, 100)",
        });
      } else if (loadPattern.requestsPerSecond > 1000) {
        issues.push({
          type: "warning",
          field: "loadPattern.requestsPerSecond",
          message: "Very high RPS may overwhelm the target system",
          severity: "medium",
          suggestion:
            "Consider starting with a lower RPS and increasing gradually",
        });
      }
    }

    // Validate ramp-up parameters for ramp-up tests
    if (loadPattern.type === "ramp-up" && !loadPattern.rampUpTime) {
      issues.push({
        type: "warning",
        field: "loadPattern.rampUpTime",
        message: "Ramp-up time not specified for ramp-up test",
        severity: "medium",
        suggestion:
          'Specify how long the ramp-up should take (e.g., "2 minutes")',
      });
    }

    return issues;
  }

  private static validatePayloadStructure(
    spec: LoadTestSpec,
    context: ValidationContext
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    spec.requests?.forEach((request, index) => {
      if (request.payload) {
        const payload = request.payload;

        // Check if template is valid JSON for JSON payloads
        if (
          request.headers?.["Content-Type"]?.includes("application/json") ||
          !request.headers?.["Content-Type"]
        ) {
          try {
            // Try to parse template with placeholder values
            const testTemplate = payload.template.replace(
              /\{\{(\w+)\}\}/g,
              '"test_value"'
            );
            JSON.parse(testTemplate);
          } catch (error) {
            issues.push({
              type: "error",
              field: `requests[${index}].payload.template`,
              message: `Request ${
                index + 1
              }: Payload template is not valid JSON`,
              severity: "high",
              suggestion:
                "Ensure payload template is valid JSON with {{variable}} placeholders",
            });
          }
        }

        // Check if variables are defined for template placeholders
        const templateVariables = CommandValidator.extractTemplateVariables(
          payload.template
        );
        const definedVariables = payload.variables?.map((v) => v.name) || [];

        const missingVariables = templateVariables.filter(
          (v) => !definedVariables.includes(v)
        );
        if (missingVariables.length > 0) {
          issues.push({
            type: "warning",
            field: `requests[${index}].payload.variables`,
            message: `Request ${index + 1}: Variables ${missingVariables.join(
              ", "
            )} used in template but not defined`,
            severity: "medium",
            suggestion: "Define variable types for all template placeholders",
          });
        }

        // Check for unused variable definitions
        const unusedVariables = definedVariables.filter(
          (v) => !templateVariables.includes(v)
        );
        if (unusedVariables.length > 0) {
          issues.push({
            type: "suggestion",
            field: `requests[${index}].payload.variables`,
            message: `Request ${index + 1}: Variables ${unusedVariables.join(
              ", "
            )} defined but not used in template`,
            severity: "low",
            suggestion:
              "Remove unused variable definitions or add them to the template",
          });
        }
      }

      // Check if payload is expected but missing
      if (
        ["POST", "PUT", "PATCH"].includes(request.method) &&
        !request.payload
      ) {
        issues.push({
          type: "suggestion",
          field: `requests[${index}].payload`,
          message: `Request ${index + 1}: ${
            request.method
          } request typically includes a payload`,
          severity: "low",
          suggestion: "Consider adding a payload template for this request",
        });
      }
    });

    return issues;
  }

  private static validateDuration(
    spec: LoadTestSpec,
    context: ValidationContext
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!spec.duration) {
      issues.push({
        type: "error",
        field: "duration",
        message: "Test duration is required",
        severity: "critical",
        suggestion:
          'Specify how long the test should run (e.g., "5 minutes", "30 seconds")',
      });
      return issues;
    }

    if (spec.duration.value <= 0) {
      issues.push({
        type: "error",
        field: "duration.value",
        message: "Test duration must be positive",
        severity: "high",
        suggestion: "Set a positive duration value",
      });
    }

    // Check for very short durations
    const durationInSeconds = CommandValidator.convertToSeconds(spec.duration);
    if (durationInSeconds < 10) {
      issues.push({
        type: "warning",
        field: "duration",
        message: "Very short test duration may not provide meaningful results",
        severity: "medium",
        suggestion: "Consider running the test for at least 30 seconds",
      });
    }

    // Check for very long durations
    if (durationInSeconds > 3600) {
      // 1 hour
      issues.push({
        type: "warning",
        field: "duration",
        message: "Very long test duration may consume significant resources",
        severity: "medium",
        suggestion:
          "Consider starting with shorter tests and increasing duration gradually",
      });
    }

    return issues;
  }

  private static validateTestTypeConsistency(
    spec: LoadTestSpec,
    context: ValidationContext
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check if test type matches load pattern
    if (spec.testType === "spike" && spec.loadPattern?.type !== "spike") {
      issues.push({
        type: "warning",
        field: "testType",
        message: 'Test type "spike" should use spike load pattern',
        severity: "medium",
        suggestion: 'Change load pattern type to "spike" or adjust test type',
      });
    }

    if (spec.testType === "stress" && spec.loadPattern?.type !== "ramp-up") {
      issues.push({
        type: "suggestion",
        field: "testType",
        message: "Stress tests typically use ramp-up load pattern",
        severity: "low",
        suggestion: 'Consider using "ramp-up" load pattern for stress testing',
      });
    }

    return issues;
  }

  private static validateWorkflowIntegrity(
    spec: LoadTestSpec,
    context: ValidationContext
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (spec.workflow && spec.workflow.length > 0) {
      // Check for circular dependencies
      const stepIds = spec.workflow.map((step) => step.id);
      const duplicateIds = stepIds.filter(
        (id, index) => stepIds.indexOf(id) !== index
      );

      if (duplicateIds.length > 0) {
        issues.push({
          type: "error",
          field: "workflow",
          message: `Duplicate workflow step IDs: ${duplicateIds.join(", ")}`,
          severity: "high",
          suggestion: "Ensure all workflow step IDs are unique",
        });
      }

      // Validate data correlation references
      if (spec.dataCorrelation) {
        spec.dataCorrelation.forEach((rule, index) => {
          if (!stepIds.includes(rule.sourceStep)) {
            issues.push({
              type: "error",
              field: `dataCorrelation[${index}].sourceStep`,
              message: `Data correlation references non-existent step: ${rule.sourceStep}`,
              severity: "high",
              suggestion:
                "Ensure correlation rules reference valid workflow step IDs",
            });
          }

          if (!stepIds.includes(rule.targetStep)) {
            issues.push({
              type: "error",
              field: `dataCorrelation[${index}].targetStep`,
              message: `Data correlation references non-existent step: ${rule.targetStep}`,
              severity: "high",
              suggestion:
                "Ensure correlation rules reference valid workflow step IDs",
            });
          }
        });
      }
    }

    return issues;
  }

  private static generateActionableSuggestions(
    issues: ValidationIssue[],
    context: ValidationContext
  ): string[] {
    const suggestions: string[] = [];

    // Add suggestions from issues
    issues.forEach((issue) => {
      if (issue.suggestion && !suggestions.includes(issue.suggestion)) {
        suggestions.push(issue.suggestion);
      }
    });

    // Add context-based suggestions
    if (context.confidence < 0.5) {
      suggestions.push(
        "Try rephrasing your command with more specific details"
      );
    }

    if (context.ambiguities.length > 0) {
      suggestions.push("Provide more specific information to reduce ambiguity");
    }

    // Add general suggestions based on common patterns
    const input = context.originalInput.toLowerCase();
    if (!input.includes("http") && !input.includes("/")) {
      suggestions.push(
        "Include the complete API endpoint URL you want to test"
      );
    }

    if (!input.match(/\d+/)) {
      suggestions.push(
        "Specify numeric values for load parameters (users, requests, duration)"
      );
    }

    return suggestions;
  }

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      // Check if it's a relative URL
      return url.startsWith("/") && url.length > 1;
    }
  }

  private static extractTemplateVariables(template: string): string[] {
    const variables: string[] = [];
    const regex = /\{\{(\w+)\}\}/g;
    let match;

    while ((match = regex.exec(template)) !== null) {
      if (!variables.includes(match[1])) {
        variables.push(match[1]);
      }
    }

    return variables;
  }

  private static convertToSeconds(duration: {
    value: number;
    unit: string;
  }): number {
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
