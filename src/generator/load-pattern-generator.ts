import {
  LoadPattern,
  Duration,
  TestType,
  K6Stage,
  ValidationResult,
} from "../types";

export interface LoadPatternGenerator {
  generatePattern(
    testType: TestType,
    parameters: LoadPatternParameters
  ): LoadPattern;
  generateK6Stages(pattern: LoadPattern): K6Stage[];
  validatePattern(pattern: LoadPattern): ValidationResult;
  optimizePattern(pattern: LoadPattern): LoadPattern;
}

export interface LoadPatternParameters {
  // Common parameters
  maxVirtualUsers?: number;
  duration?: Duration;

  // Spike testing parameters
  spikeIntensity?: number; // multiplier for spike load
  spikeDuration?: Duration;
  baselineVUs?: number;

  // Stress testing parameters
  rampUpDuration?: Duration;
  plateauDuration?: Duration;
  rampDownDuration?: Duration;
  stressTarget?: number;

  // Endurance testing parameters
  sustainedLoad?: number;
  enduranceDuration?: Duration;

  // Volume testing parameters
  concurrentUsers?: number;
  volumeTarget?: number;

  // Baseline testing parameters
  baselineDuration?: Duration;
}

export class K6LoadPatternGenerator implements LoadPatternGenerator {
  generatePattern(
    testType: TestType,
    parameters: LoadPatternParameters
  ): LoadPattern {
    switch (testType) {
      case "spike":
        return this.generateSpikePattern(parameters);
      case "stress":
        return this.generateStressPattern(parameters);
      case "endurance":
        return this.generateEndurancePattern(parameters);
      case "volume":
        return this.generateVolumePattern(parameters);
      case "baseline":
        return this.generateBaselinePattern(parameters);
      default:
        throw new Error(`Unsupported test type: ${testType}`);
    }
  }

  generateK6Stages(pattern: LoadPattern): K6Stage[] {
    switch (pattern.type) {
      case "spike":
        return this.generateSpikeStages(pattern);
      case "ramp-up":
        return this.generateRampUpStages(pattern);
      case "constant":
        return this.generateConstantStages(pattern);
      case "step":
        return this.generateStepStages(pattern);
      default:
        return [];
    }
  }

  validatePattern(pattern: LoadPattern): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate virtual users
    if (pattern.virtualUsers !== undefined && pattern.virtualUsers < 1) {
      errors.push("Virtual users must be at least 1");
    }

    if (pattern.virtualUsers !== undefined && pattern.virtualUsers > 10000) {
      warnings.push("High virtual user count may cause resource issues");
    }

    // Validate RPS
    if (
      pattern.requestsPerSecond !== undefined &&
      pattern.requestsPerSecond < 0.1
    ) {
      errors.push("Requests per second must be at least 0.1");
    }

    if (
      pattern.requestsPerSecond !== undefined &&
      pattern.requestsPerSecond > 10000
    ) {
      warnings.push("High RPS may overwhelm target system");
    }

    // Validate durations
    if (pattern.rampUpTime && !this.isValidDuration(pattern.rampUpTime)) {
      errors.push("Invalid ramp-up duration");
    }

    if (pattern.plateauTime && !this.isValidDuration(pattern.plateauTime)) {
      errors.push("Invalid plateau duration");
    }

    // Pattern-specific validations
    if (pattern.type === "spike") {
      if (!pattern.virtualUsers) {
        errors.push("Spike testing requires virtual users to be specified");
      }
      if (
        pattern.baselineVUs &&
        pattern.virtualUsers &&
        pattern.baselineVUs >= pattern.virtualUsers
      ) {
        errors.push(
          "Spike virtual users must be greater than baseline virtual users"
        );
      }
    }

    if (pattern.type === "ramp-up") {
      if (!pattern.rampUpTime) {
        errors.push("Ramp-up testing requires ramp-up time to be specified");
      }
      if (!pattern.plateauTime) {
        warnings.push("Consider specifying plateau time for ramp-up testing");
      }
    }

    if (pattern.type === "step") {
      if (!pattern.virtualUsers) {
        errors.push("Step testing requires virtual users to be specified");
      }
      if (pattern.virtualUsers && pattern.virtualUsers > 5000) {
        warnings.push(
          "High virtual user count in step testing may cause resource spikes"
        );
      }
    }

    if (pattern.type === "constant") {
      if (!pattern.virtualUsers && !pattern.requestsPerSecond) {
        errors.push(
          "Constant load testing requires either virtual users or RPS to be specified"
        );
      }
      if (
        pattern.plateauTime &&
        this.convertDurationToSeconds(pattern.plateauTime) > 14400
      ) {
        // 4 hours
        warnings.push(
          "Very long constant load tests may require additional monitoring"
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  optimizePattern(pattern: LoadPattern): LoadPattern {
    const optimized = { ...pattern };

    // Optimize virtual users based on pattern type
    if (
      pattern.type === "spike" &&
      pattern.virtualUsers &&
      pattern.virtualUsers > 1000
    ) {
      // For spike tests, limit VUs to prevent system overload
      optimized.virtualUsers = Math.min(pattern.virtualUsers, 1000);
    }

    // Volume testing optimizations
    if (
      pattern.type === "step" &&
      pattern.virtualUsers &&
      pattern.virtualUsers > 2000
    ) {
      // For volume tests, cap at reasonable limits and warn
      optimized.virtualUsers = Math.min(pattern.virtualUsers, 2000);
      // Increase ramp-up time for high volume
      if (
        !pattern.rampUpTime ||
        this.convertDurationToSeconds(pattern.rampUpTime) < 600
      ) {
        optimized.rampUpTime = { value: 10, unit: "minutes" };
      }
    }

    // Baseline testing optimizations
    if (
      pattern.type === "constant" &&
      pattern.virtualUsers &&
      pattern.virtualUsers > 100
    ) {
      // Baseline tests should be moderate load
      if (
        pattern.plateauTime &&
        this.convertDurationToSeconds(pattern.plateauTime) < 600
      ) {
        // If it's a short test with high VUs, it might be misclassified
        optimized.virtualUsers = Math.min(pattern.virtualUsers, 50);
      }
    }

    // Optimize durations for better resource usage
    if (
      pattern.rampUpTime &&
      this.convertDurationToSeconds(pattern.rampUpTime) < 30
    ) {
      // Minimum ramp-up time for realistic testing
      optimized.rampUpTime = { value: 30, unit: "seconds" };
    }

    // Add default plateau time if missing for ramp-up tests
    if (pattern.type === "ramp-up" && !pattern.plateauTime) {
      optimized.plateauTime = { value: 60, unit: "seconds" };
    }

    // Optimize endurance test durations
    if (pattern.type === "constant" && pattern.plateauTime) {
      const plateauSeconds = this.convertDurationToSeconds(pattern.plateauTime);
      if (plateauSeconds > 28800) {
        // 8 hours
        // Very long tests should have lower VU counts
        if (pattern.virtualUsers && pattern.virtualUsers > 25) {
          optimized.virtualUsers = Math.min(pattern.virtualUsers, 25);
        }
      }
    }

    // Optimize step testing parameters (only if not already optimized by volume testing)
    if (
      pattern.type === "step" &&
      !(pattern.virtualUsers && pattern.virtualUsers > 2000)
    ) {
      // Ensure reasonable step duration by adjusting ramp-up time
      if (
        pattern.rampUpTime &&
        this.convertDurationToSeconds(pattern.rampUpTime) < 300
      ) {
        optimized.rampUpTime = { value: 5, unit: "minutes" };
      }
    }

    return optimized;
  }

  private generateSpikePattern(parameters: LoadPatternParameters): LoadPattern {
    const baselineVUs = parameters.baselineVUs || 1;
    const maxVUs =
      parameters.maxVirtualUsers ||
      baselineVUs * (parameters.spikeIntensity || 10);
    const spikeDuration = parameters.spikeDuration || {
      value: 30,
      unit: "seconds",
    };

    return {
      type: "spike",
      virtualUsers: maxVUs,
      rampUpTime: { value: 10, unit: "seconds" }, // Quick ramp-up for spike
      plateauTime: spikeDuration,
      rampDownTime: { value: 10, unit: "seconds" }, // Quick ramp-down
      baselineVUs,
      spikeIntensity: parameters.spikeIntensity || 10,
    };
  }

  private generateStressPattern(
    parameters: LoadPatternParameters
  ): LoadPattern {
    const maxVUs = parameters.maxVirtualUsers || parameters.stressTarget || 100;
    const rampUpDuration = parameters.rampUpDuration || {
      value: 300,
      unit: "seconds",
    }; // 5 minutes
    const plateauDuration = parameters.plateauDuration || {
      value: 600,
      unit: "seconds",
    }; // 10 minutes
    const rampDownDuration = parameters.rampDownDuration || {
      value: 60,
      unit: "seconds",
    };

    return {
      type: "ramp-up",
      virtualUsers: maxVUs,
      rampUpTime: rampUpDuration,
      plateauTime: plateauDuration,
      rampDownTime: rampDownDuration,
    };
  }

  private generateEndurancePattern(
    parameters: LoadPatternParameters
  ): LoadPattern {
    const sustainedVUs = parameters.sustainedLoad || 50;
    const duration = parameters.enduranceDuration || {
      value: 2,
      unit: "hours",
    };

    return {
      type: "constant",
      virtualUsers: sustainedVUs,
      plateauTime: duration,
      rampUpTime: { value: 60, unit: "seconds" }, // Gentle ramp-up
      rampDownTime: { value: 60, unit: "seconds" }, // Gentle ramp-down
    };
  }

  private generateVolumePattern(
    parameters: LoadPatternParameters
  ): LoadPattern {
    const concurrentUsers =
      parameters.concurrentUsers || parameters.volumeTarget || 500;
    const duration = parameters.duration || { value: 30, unit: "minutes" };

    // Volume testing uses step pattern to gradually increase load
    return {
      type: "step",
      virtualUsers: concurrentUsers,
      plateauTime: duration,
      rampUpTime: { value: 300, unit: "seconds" }, // 5 minutes to reach volume in steps
      rampDownTime: { value: 120, unit: "seconds" }, // 2 minutes to ramp down
      volumeTarget: concurrentUsers,
    };
  }

  private generateBaselinePattern(
    parameters: LoadPatternParameters
  ): LoadPattern {
    const baselineVUs = parameters.baselineVUs || 10;
    const duration = parameters.baselineDuration || {
      value: 10,
      unit: "minutes",
    };

    return {
      type: "constant",
      virtualUsers: baselineVUs,
      plateauTime: duration,
      rampUpTime: { value: 30, unit: "seconds" },
      rampDownTime: { value: 30, unit: "seconds" },
    };
  }

  private generateSpikeStages(pattern: LoadPattern): K6Stage[] {
    const stages: K6Stage[] = [];
    const baselineVUs = (pattern as any).baselineVUs || 1;
    const maxVUs = pattern.virtualUsers || 10;

    // Start with baseline
    stages.push({
      duration: "30s",
      target: baselineVUs,
    });

    // Rapid spike up
    stages.push({
      duration: this.formatDuration(
        pattern.rampUpTime || { value: 10, unit: "seconds" }
      ),
      target: maxVUs,
    });

    // Hold spike
    stages.push({
      duration: this.formatDuration(
        pattern.plateauTime || { value: 30, unit: "seconds" }
      ),
      target: maxVUs,
    });

    // Rapid spike down
    stages.push({
      duration: this.formatDuration(
        (pattern as any).rampDownTime || { value: 10, unit: "seconds" }
      ),
      target: baselineVUs,
    });

    // Return to baseline
    stages.push({
      duration: "30s",
      target: baselineVUs,
    });

    return stages;
  }

  private generateRampUpStages(pattern: LoadPattern): K6Stage[] {
    const stages: K6Stage[] = [];
    const maxVUs = pattern.virtualUsers || 10;

    // Ramp up
    stages.push({
      duration: this.formatDuration(
        pattern.rampUpTime || { value: 60, unit: "seconds" }
      ),
      target: maxVUs,
    });

    // Plateau
    if (pattern.plateauTime) {
      stages.push({
        duration: this.formatDuration(pattern.plateauTime),
        target: maxVUs,
      });
    }

    // Ramp down
    const rampDownTime = (pattern as any).rampDownTime || {
      value: 60,
      unit: "seconds",
    };
    stages.push({
      duration: this.formatDuration(rampDownTime),
      target: 0,
    });

    return stages;
  }

  private generateConstantStages(pattern: LoadPattern): K6Stage[] {
    const stages: K6Stage[] = [];
    const vus = pattern.virtualUsers || 10;

    // Ramp up to target
    stages.push({
      duration: this.formatDuration(
        pattern.rampUpTime || { value: 30, unit: "seconds" }
      ),
      target: vus,
    });

    // Hold constant load
    stages.push({
      duration: this.formatDuration(
        pattern.plateauTime || { value: 300, unit: "seconds" }
      ),
      target: vus,
    });

    // Ramp down
    const rampDownTime = (pattern as any).rampDownTime || {
      value: 30,
      unit: "seconds",
    };
    stages.push({
      duration: this.formatDuration(rampDownTime),
      target: 0,
    });

    return stages;
  }

  private generateStepStages(pattern: LoadPattern): K6Stage[] {
    const stages: K6Stage[] = [];
    const maxVUs = pattern.virtualUsers || 100;
    const steps = 5; // Number of steps
    const stepSize = Math.ceil(maxVUs / steps);
    const stepDuration = "60s"; // 1 minute per step

    // Step up
    for (let i = 1; i <= steps; i++) {
      stages.push({
        duration: stepDuration,
        target: Math.min(i * stepSize, maxVUs),
      });
    }

    // Hold at max
    stages.push({
      duration: this.formatDuration(
        pattern.plateauTime || { value: 300, unit: "seconds" }
      ),
      target: maxVUs,
    });

    // Step down
    for (let i = steps - 1; i >= 0; i--) {
      stages.push({
        duration: stepDuration,
        target: i * stepSize,
      });
    }

    return stages;
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

  private isValidDuration(duration: Duration): boolean {
    return (
      duration.value > 0 &&
      ["seconds", "minutes", "hours"].includes(duration.unit)
    );
  }
}
