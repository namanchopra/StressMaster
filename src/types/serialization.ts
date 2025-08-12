import {
  LoadTestSpec,
  RequestSpec,
  LoadPattern,
  PayloadSpec,
  ValidationResult,
} from "./index";
import { validateLoadTestSpec } from "./validation";

/**
 * Serializes a LoadTestSpec to JSON string
 */
export function serializeLoadTestSpec(spec: LoadTestSpec): string {
  try {
    return JSON.stringify(spec, null, 2);
  } catch (error) {
    throw new Error(
      `Failed to serialize LoadTestSpec: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Deserializes a JSON string to LoadTestSpec with validation
 */
export function deserializeLoadTestSpec(json: string): {
  spec: LoadTestSpec | null;
  validation: ValidationResult;
} {
  try {
    const parsed = JSON.parse(json);
    const validation = validateLoadTestSpec(parsed);

    if (validation.isValid) {
      return { spec: parsed as LoadTestSpec, validation };
    } else {
      return { spec: null, validation };
    }
  } catch (error) {
    return {
      spec: null,
      validation: {
        isValid: false,
        errors: [
          `Invalid JSON format: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ],
        warnings: [],
      },
    };
  }
}

/**
 * Serializes a RequestSpec to JSON string
 */
export function serializeRequestSpec(spec: RequestSpec): string {
  try {
    return JSON.stringify(spec, null, 2);
  } catch (error) {
    throw new Error(
      `Failed to serialize RequestSpec: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Deserializes a JSON string to RequestSpec
 */
export function deserializeRequestSpec(json: string): RequestSpec {
  try {
    return JSON.parse(json) as RequestSpec;
  } catch (error) {
    throw new Error(
      `Failed to deserialize RequestSpec: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Serializes a LoadPattern to JSON string
 */
export function serializeLoadPattern(pattern: LoadPattern): string {
  try {
    return JSON.stringify(pattern, null, 2);
  } catch (error) {
    throw new Error(
      `Failed to serialize LoadPattern: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Deserializes a JSON string to LoadPattern
 */
export function deserializeLoadPattern(json: string): LoadPattern {
  try {
    return JSON.parse(json) as LoadPattern;
  } catch (error) {
    throw new Error(
      `Failed to deserialize LoadPattern: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Serializes a PayloadSpec to JSON string
 */
export function serializePayloadSpec(spec: PayloadSpec): string {
  try {
    return JSON.stringify(spec, null, 2);
  } catch (error) {
    throw new Error(
      `Failed to serialize PayloadSpec: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Deserializes a JSON string to PayloadSpec
 */
export function deserializePayloadSpec(json: string): PayloadSpec {
  try {
    return JSON.parse(json) as PayloadSpec;
  } catch (error) {
    throw new Error(
      `Failed to deserialize PayloadSpec: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Utility function to safely parse JSON with error handling
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Utility function to create a deep copy of an object through serialization
 */
export function deepClone<T>(obj: T): T {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (error) {
    throw new Error(
      `Failed to deep clone object: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Validates and normalizes a LoadTestSpec from potentially untrusted JSON
 */
export function parseAndValidateLoadTestSpec(json: string): LoadTestSpec {
  const { spec, validation } = deserializeLoadTestSpec(json);

  if (!validation.isValid) {
    throw new Error(`Invalid LoadTestSpec: ${validation.errors.join(", ")}`);
  }

  if (!spec) {
    throw new Error("Failed to parse LoadTestSpec");
  }

  return spec;
}
