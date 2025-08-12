// K6-specific types and interfaces

export interface K6Script {
  id: string;
  name: string;
  content: string;
  imports: string[];
  options: K6Options;
  metadata: ScriptMetadata;
}

export interface K6Options {
  vus?: number;
  duration?: string;
  rps?: number;
  stages?: K6Stage[];
  thresholds?: Record<string, string[]>;
  setupTimeout?: string;
  teardownTimeout?: string;
}

export interface K6Stage {
  duration: string;
  target: number;
}

export interface ScriptMetadata {
  generatedAt: Date;
  specId: string;
  version: string;
  description: string;
  tags: string[];
}

export interface K6Metrics {
  checks: Record<string, K6Check>;
  data_received: K6Metric;
  data_sent: K6Metric;
  http_req_blocked: K6Metric;
  http_req_connecting: K6Metric;
  http_req_duration: K6Metric;
  http_req_failed: K6Metric;
  http_req_receiving: K6Metric;
  http_req_sending: K6Metric;
  http_req_tls_handshaking: K6Metric;
  http_req_waiting: K6Metric;
  http_reqs: K6Metric;
  iteration_duration: K6Metric;
  iterations: K6Metric;
  vus: K6Metric;
  vus_max: K6Metric;
}

export interface K6Metric {
  type: string;
  contains: string;
  values: {
    count: number;
    rate: number;
    avg: number;
    min: number;
    med: number;
    max: number;
    "p(90)": number;
    "p(95)": number;
    "p(99)": number;
  };
}

export interface K6Check {
  name: string;
  path: string;
  id: string;
  passes: number;
  fails: number;
}

export interface K6ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  metrics: K6Metrics;
  duration: number;
}
