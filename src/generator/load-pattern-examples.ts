import {
  K6LoadPatternGenerator,
  LoadPatternParameters,
} from "./load-pattern-generator";
import { TestType, LoadPattern } from "../types";

/**
 * Example utility demonstrating how to use the load pattern generator
 * for different types of load testing scenarios.
 */
export class LoadPatternExamples {
  private generator: K6LoadPatternGenerator;

  constructor() {
    this.generator = new K6LoadPatternGenerator();
  }

  /**
   * Generate a spike test pattern for testing sudden load increases
   */
  createSpikeTestPattern(
    baselineUsers: number = 10,
    spikeMultiplier: number = 10
  ): LoadPattern {
    const parameters: LoadPatternParameters = {
      baselineVUs: baselineUsers,
      maxVirtualUsers: baselineUsers * spikeMultiplier,
      spikeIntensity: spikeMultiplier,
      spikeDuration: { value: 30, unit: "seconds" },
    };

    const pattern = this.generator.generatePattern("spike", parameters);
    const optimized = this.generator.optimizePattern(pattern);

    return optimized;
  }

  /**
   * Generate a stress test pattern for gradual load increase
   */
  createStressTestPattern(
    maxUsers: number = 100,
    rampUpMinutes: number = 5
  ): LoadPattern {
    const parameters: LoadPatternParameters = {
      maxVirtualUsers: maxUsers,
      rampUpDuration: { value: rampUpMinutes, unit: "minutes" },
      plateauDuration: { value: rampUpMinutes * 2, unit: "minutes" },
      rampDownDuration: { value: 2, unit: "minutes" },
    };

    const pattern = this.generator.generatePattern("stress", parameters);
    const optimized = this.generator.optimizePattern(pattern);

    return optimized;
  }

  /**
   * Generate an endurance test pattern for sustained load over time
   */
  createEnduranceTestPattern(
    sustainedUsers: number = 25,
    durationHours: number = 2
  ): LoadPattern {
    const parameters: LoadPatternParameters = {
      sustainedLoad: sustainedUsers,
      enduranceDuration: { value: durationHours, unit: "hours" },
    };

    const pattern = this.generator.generatePattern("endurance", parameters);
    const optimized = this.generator.optimizePattern(pattern);

    return optimized;
  }

  /**
   * Generate a volume test pattern for high concurrent user simulation
   */
  createVolumeTestPattern(
    concurrentUsers: number = 1000,
    durationMinutes: number = 30
  ): LoadPattern {
    const parameters: LoadPatternParameters = {
      concurrentUsers,
      duration: { value: durationMinutes, unit: "minutes" },
    };

    const pattern = this.generator.generatePattern("volume", parameters);
    const optimized = this.generator.optimizePattern(pattern);

    return optimized;
  }

  /**
   * Generate a baseline test pattern for establishing performance benchmarks
   */
  createBaselineTestPattern(
    baselineUsers: number = 10,
    durationMinutes: number = 10
  ): LoadPattern {
    const parameters: LoadPatternParameters = {
      baselineVUs: baselineUsers,
      baselineDuration: { value: durationMinutes, unit: "minutes" },
    };

    const pattern = this.generator.generatePattern("baseline", parameters);
    const optimized = this.generator.optimizePattern(pattern);

    return optimized;
  }

  /**
   * Validate and optimize any load pattern
   */
  validateAndOptimize(pattern: LoadPattern): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    optimizedPattern: LoadPattern;
  } {
    const validation = this.generator.validatePattern(pattern);
    const optimizedPattern = this.generator.optimizePattern(pattern);

    return {
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings,
      optimizedPattern,
    };
  }

  /**
   * Generate K6 stages for any load pattern
   */
  generateK6Stages(pattern: LoadPattern) {
    return this.generator.generateK6Stages(pattern);
  }

  /**
   * Get recommended patterns for common scenarios
   */
  getRecommendedPatterns() {
    return {
      // Quick API health check
      healthCheck: this.createBaselineTestPattern(5, 2),

      // Standard load test
      standardLoad: this.createStressTestPattern(50, 3),

      // Peak traffic simulation
      peakTraffic: this.createSpikeTestPattern(20, 5),

      // Long-running stability test
      stabilityTest: this.createEnduranceTestPattern(15, 4),

      // High volume capacity test
      capacityTest: this.createVolumeTestPattern(500, 20),
    };
  }
}

/**
 * Example usage demonstrating different load testing patterns
 */
export function demonstrateLoadPatterns() {
  const examples = new LoadPatternExamples();

  console.log("=== Load Testing Pattern Examples ===\n");

  // Spike Test Example
  const spikePattern = examples.createSpikeTestPattern(10, 8);
  console.log("Spike Test Pattern:");
  console.log(`- Type: ${spikePattern.type}`);
  console.log(`- Virtual Users: ${spikePattern.virtualUsers}`);
  console.log(`- Baseline VUs: ${spikePattern.baselineVUs}`);
  console.log(`- Spike Intensity: ${spikePattern.spikeIntensity}x`);
  console.log(
    `- K6 Stages: ${JSON.stringify(
      examples.generateK6Stages(spikePattern),
      null,
      2
    )}\n`
  );

  // Volume Test Example
  const volumePattern = examples.createVolumeTestPattern(1500, 45);
  console.log("Volume Test Pattern:");
  console.log(`- Type: ${volumePattern.type}`);
  console.log(`- Virtual Users: ${volumePattern.virtualUsers}`);
  console.log(`- Volume Target: ${volumePattern.volumeTarget}`);
  console.log(
    `- Duration: ${volumePattern.plateauTime?.value} ${volumePattern.plateauTime?.unit}`
  );
  console.log(
    `- K6 Stages: ${examples.generateK6Stages(volumePattern).length} stages\n`
  );

  // Validation Example
  const invalidPattern: LoadPattern = {
    type: "spike",
    virtualUsers: 50,
    baselineVUs: 60, // Invalid: baseline higher than max
  };

  const validation = examples.validateAndOptimize(invalidPattern);
  console.log("Validation Example:");
  console.log(`- Is Valid: ${validation.isValid}`);
  console.log(`- Errors: ${validation.errors.join(", ")}`);
  console.log(`- Optimized VUs: ${validation.optimizedPattern.virtualUsers}\n`);

  // Recommended Patterns
  const recommended = examples.getRecommendedPatterns();
  console.log("Recommended Patterns:");
  Object.entries(recommended).forEach(([name, pattern]) => {
    console.log(`- ${name}: ${pattern.type} with ${pattern.virtualUsers} VUs`);
  });
}
