import {
  HttpMethod,
  TestType,
  LoadPatternType,
  VariableType,
  Duration,
} from "./common";

export interface LoadTestSpec {
  id: string;
  name: string;
  description: string;
  testType: TestType;

  requests: RequestSpec[];
  loadPattern: LoadPattern;
  duration: Duration;

  // For multi-step scenarios
  workflow?: WorkflowStep[];
  dataCorrelation?: CorrelationRule[];
}

export interface RequestSpec {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  payload?: PayloadSpec;
  validation?: ResponseValidation[];
}

export interface LoadPattern {
  type: LoadPatternType;
  virtualUsers?: number;
  requestsPerSecond?: number;
  rampUpTime?: Duration;
  plateauTime?: Duration;
  rampDownTime?: Duration;

  // Spike testing specific
  baselineVUs?: number;
  spikeIntensity?: number;

  // Volume testing specific
  volumeTarget?: number;

  // K6 stages for complex patterns
  stages?: Array<{
    duration: string;
    target: number;
  }>;
}

export interface PayloadSpec {
  template: string;
  variables: VariableDefinition[];
}

export interface VariableDefinition {
  name: string;
  type: VariableType;
  parameters?: Record<string, any>;
}

export interface WorkflowStep {
  id: string;
  name: string;
  request: RequestSpec;
  thinkTime?: Duration;
  conditions?: StepCondition[];
  dataExtraction?: DataExtraction[];
}

export interface CorrelationRule {
  sourceStep: string;
  sourceField: string;
  targetStep: string;
  targetField: string;
}

export interface ResponseValidation {
  type: "status_code" | "response_time" | "content" | "header";
  condition: string;
  expectedValue: any;
}

export interface StepCondition {
  type: "response_code" | "response_content" | "response_time";
  operator: "equals" | "not_equals" | "greater_than" | "less_than" | "contains";
  value: any;
  action: "continue" | "skip" | "fail";
}

export interface DataExtraction {
  name: string;
  source: "response_body" | "response_header" | "status_code";
  extractor: "json_path" | "regex" | "xpath";
  expression: string;
}
