import type {
  ReleaseReadinessOptions,
  ReleaseReadinessResult,
} from "./release-readiness";
import { runReleaseReadiness } from "./release-readiness";
import type {
  ValidationRunResult,
} from "./validation-suite";
import { runValidationSuites } from "./validation-suite";
import type {
  ValidationSoakSeriesOptions,
  ValidationSoakSeriesResult,
} from "./validation-soak-series";
import { runValidationSoakSeries } from "./validation-soak-series";

export type ValidationProfileId = "smoke" | "nightly" | "prerelease" | "weekly";
export type ValidationProfileStageId = "validation-run" | "release-readiness" | "soak-series";
export type ValidationProfileIssueKind = "validation-item" | "release-check" | "soak-suite";

export interface ValidationProfileDescriptor {
  profileId: ValidationProfileId;
  title: string;
  summary: string;
  focusAreas: string[];
  validationSelectors: string[];
  includeReleaseReadiness: boolean;
  soakSeriesCycles?: number;
  soakSeriesSelectors?: string[];
}

export interface ValidationProfileIssue {
  issueId: string;
  kind: ValidationProfileIssueKind;
  stageId: ValidationProfileStageId;
  scope: string;
  summary: string;
}

export interface ValidationProfileValidationStageResult {
  stageId: "validation-run";
  title: string;
  status: "passed" | "failed";
  durationMs: number;
  selectors: string[];
  result: ValidationRunResult;
}

export interface ValidationProfileReleaseStageResult {
  stageId: "release-readiness";
  title: string;
  status: "passed" | "failed";
  durationMs: number;
  result: ReleaseReadinessResult;
}

export interface ValidationProfileSoakStageResult {
  stageId: "soak-series";
  title: string;
  status: "passed" | "failed";
  durationMs: number;
  cycles: number;
  selectors: string[];
  result: ValidationSoakSeriesResult;
}

export type ValidationProfileStageResult =
  | ValidationProfileValidationStageResult
  | ValidationProfileReleaseStageResult
  | ValidationProfileSoakStageResult;

export interface ValidationProfileRunResult extends ValidationProfileDescriptor {
  status: "passed" | "failed";
  durationMs: number;
  totalStages: number;
  passedStages: number;
  failedStages: number;
  stages: ValidationProfileStageResult[];
  issues: ValidationProfileIssue[];
}

export interface ValidationProfileRunOptions {
  releaseReadiness?: ReleaseReadinessOptions;
  soakSeries?: Omit<ValidationSoakSeriesOptions, "cycles" | "selectors">;
}

interface ValidationProfileDeps {
  releaseReadinessRunner: (options?: ReleaseReadinessOptions) => Promise<ReleaseReadinessResult>;
  validationRunner: (selectors?: string[]) => ValidationRunResult;
  soakSeriesRunner: (options?: ValidationSoakSeriesOptions) => ValidationSoakSeriesResult;
}

const DEFAULT_SOAK_PROFILE_SELECTORS = ["soak", "realworld", "acceptance"] as const;

const PROFILE_DESCRIPTORS: Record<ValidationProfileId, ValidationProfileDescriptor> = {
  smoke: {
    profileId: "smoke",
    title: "Smoke Hardening",
    summary:
      "快速覆盖 local/browser/runtime/governance 主链，适合本地开发后的第一轮稳定性检查。",
    focusAreas: ["local", "browser", "runtime", "governance", "realworld"],
    validationSelectors: [
      "regression:browser-recovery-cold-reopen-outcome",
      "regression:runtime-prompt-console-summarizes-boundaries",
      "regression:governance-publish-readback-verifies-closure",
      "acceptance:browser-ownership-reclaim-isolation",
      "realworld:browser-research-recovery-runbook",
      "realworld:governed-publish-readback-verification",
    ],
    includeReleaseReadiness: false,
  },
  nightly: {
    profileId: "nightly",
    title: "Nightly Hardening",
    summary:
      "每天固定覆盖 acceptance / realworld / soak / failure，并附带 release readiness 与短周期 soak。",
    focusAreas: ["browser", "runtime", "release", "acceptance", "soak", "failure"],
    validationSelectors: ["failure", "acceptance", "realworld", "soak"],
    includeReleaseReadiness: true,
    soakSeriesCycles: 3,
    soakSeriesSelectors: [...DEFAULT_SOAK_PROFILE_SELECTORS],
  },
  prerelease: {
    profileId: "prerelease",
    title: "Pre-Release Confidence",
    summary:
      "发版前的高置信度验证，覆盖 full regression/failure/acceptance/realworld/soak，并执行 release readiness 与中等强度 soak。",
    focusAreas: ["local", "browser", "runtime", "release", "acceptance", "soak", "failure"],
    validationSelectors: ["regression", "failure", "acceptance", "realworld", "soak"],
    includeReleaseReadiness: true,
    soakSeriesCycles: 5,
    soakSeriesSelectors: [...DEFAULT_SOAK_PROFILE_SELECTORS],
  },
  weekly: {
    profileId: "weekly",
    title: "Weekly Stability Sweep",
    summary:
      "每周全量稳定性扫面，覆盖 full validation catalog、release readiness 与更长周期 soak。",
    focusAreas: ["local", "browser", "runtime", "release", "acceptance", "soak", "failure", "regression"],
    validationSelectors: ["regression", "failure", "acceptance", "realworld", "soak"],
    includeReleaseReadiness: true,
    soakSeriesCycles: 10,
    soakSeriesSelectors: [...DEFAULT_SOAK_PROFILE_SELECTORS],
  },
};

const DEFAULT_DEPS: ValidationProfileDeps = {
  releaseReadinessRunner: runReleaseReadiness,
  validationRunner: runValidationSuites,
  soakSeriesRunner: runValidationSoakSeries,
};

export function listValidationProfiles(): ValidationProfileDescriptor[] {
  return (["smoke", "nightly", "prerelease", "weekly"] as ValidationProfileId[]).map((profileId) => ({
    ...PROFILE_DESCRIPTORS[profileId],
    focusAreas: [...PROFILE_DESCRIPTORS[profileId].focusAreas],
    validationSelectors: [...PROFILE_DESCRIPTORS[profileId].validationSelectors],
    ...(PROFILE_DESCRIPTORS[profileId].soakSeriesSelectors
      ? { soakSeriesSelectors: [...PROFILE_DESCRIPTORS[profileId].soakSeriesSelectors] }
      : {}),
  }));
}

export function isValidationProfileId(value: string): value is ValidationProfileId {
  return value === "smoke" || value === "nightly" || value === "prerelease" || value === "weekly";
}

export async function runValidationProfile(
  profileId: ValidationProfileId,
  options: ValidationProfileRunOptions = {},
  deps: ValidationProfileDeps = DEFAULT_DEPS
): Promise<ValidationProfileRunResult> {
  const profile = PROFILE_DESCRIPTORS[profileId];
  const startedAt = Date.now();
  const stages: ValidationProfileStageResult[] = [];

  const validationStartedAt = Date.now();
  const validationResult = deps.validationRunner(profile.validationSelectors);
  stages.push({
    stageId: "validation-run",
    title: "Validation catalog run",
    status: validationResult.failedSuites === 0 ? "passed" : "failed",
    durationMs: Date.now() - validationStartedAt,
    selectors: [...profile.validationSelectors],
    result: validationResult,
  });

  if (profile.includeReleaseReadiness) {
    const releaseStartedAt = Date.now();
    const releaseResult = await deps.releaseReadinessRunner(options.releaseReadiness);
    stages.push({
      stageId: "release-readiness",
      title: "Release readiness verification",
      status: releaseResult.status,
      durationMs: Date.now() - releaseStartedAt,
      result: releaseResult,
    });
  }

  if (profile.soakSeriesCycles && profile.soakSeriesCycles > 0) {
    const soakStartedAt = Date.now();
    const soakSelectors = profile.soakSeriesSelectors ?? [...DEFAULT_SOAK_PROFILE_SELECTORS];
    const soakResult = deps.soakSeriesRunner({
      ...options.soakSeries,
      cycles: profile.soakSeriesCycles,
      selectors: soakSelectors,
    });
    stages.push({
      stageId: "soak-series",
      title: "Validation soak series",
      status: soakResult.status,
      durationMs: Date.now() - soakStartedAt,
      cycles: profile.soakSeriesCycles,
      selectors: [...soakSelectors],
      result: soakResult,
    });
  }

  const issues = collectProfileIssues(stages);
  return {
    ...profile,
    focusAreas: [...profile.focusAreas],
    validationSelectors: [...profile.validationSelectors],
    ...(profile.soakSeriesSelectors ? { soakSeriesSelectors: [...profile.soakSeriesSelectors] } : {}),
    status: stages.every((stage) => stage.status === "passed") ? "passed" : "failed",
    durationMs: Date.now() - startedAt,
    totalStages: stages.length,
    passedStages: stages.filter((stage) => stage.status === "passed").length,
    failedStages: stages.filter((stage) => stage.status === "failed").length,
    stages,
    issues,
  };
}

function collectProfileIssues(stages: ValidationProfileStageResult[]): ValidationProfileIssue[] {
  const issues: ValidationProfileIssue[] = [];

  for (const stage of stages) {
    if (stage.stageId === "validation-run") {
      for (const suite of stage.result.suites) {
        for (const item of suite.items) {
          if (item.status === "passed") {
            continue;
          }
          issues.push({
            issueId: `${stage.stageId}:${suite.suiteId}:${item.itemId}`,
            kind: "validation-item",
            stageId: stage.stageId,
            scope: `${suite.suiteId}:${item.itemId}`,
            summary: `[${item.area}] ${item.title} failed ${item.failedCases}/${item.totalCases} cases`,
          });
        }
      }
      continue;
    }

    if (stage.stageId === "release-readiness") {
      for (const check of stage.result.checks) {
        if (check.status === "passed") {
          continue;
        }
        issues.push({
          issueId: `${stage.stageId}:${check.checkId}`,
          kind: "release-check",
          stageId: stage.stageId,
          scope: check.checkId,
          summary: `${check.title} failed`,
        });
      }
      continue;
    }

    for (const aggregate of stage.result.suiteAggregates) {
      if (aggregate.failedCycles === 0) {
        continue;
      }
      issues.push({
        issueId: `${stage.stageId}:${aggregate.suiteId}`,
        kind: "soak-suite",
        stageId: stage.stageId,
        scope: aggregate.suiteId,
        summary: `${aggregate.suiteId} failed ${aggregate.failedCycles}/${aggregate.cycles} soak cycles`,
      });
    }
  }

  return issues;
}

export function summarizeValidationStage(
  stage: ValidationProfileStageResult
): string {
  if (stage.stageId === "validation-run") {
    return `suites=${stage.result.passedSuites}/${stage.result.totalSuites} items=${stage.result.passedItems}/${stage.result.totalItems} cases=${stage.result.passedCases}/${stage.result.totalCases}`;
  }
  if (stage.stageId === "release-readiness") {
    return `checks=${stage.result.passedChecks}/${stage.result.totalChecks}`;
  }
  return `cycles=${stage.result.passedCycles}/${stage.result.totalCycles} cases=${stage.result.totalCases - stage.result.failedCases}/${stage.result.totalCases}`;
}

export function summarizeValidationProfileResult(
  result: ValidationProfileRunResult
): string {
  return `stages=${result.passedStages}/${result.totalStages} issues=${result.issues.length} durationMs=${result.durationMs}`;
}

export function getValidationProfile(profileId: ValidationProfileId): ValidationProfileDescriptor {
  const descriptor = PROFILE_DESCRIPTORS[profileId];
  return {
    ...descriptor,
    focusAreas: [...descriptor.focusAreas],
    validationSelectors: [...descriptor.validationSelectors],
    ...(descriptor.soakSeriesSelectors ? { soakSeriesSelectors: [...descriptor.soakSeriesSelectors] } : {}),
  };
}
