import assert from "node:assert/strict";
import test from "node:test";

import {
  buildValidationOpsRecordFromReleaseReadiness,
  buildValidationOpsRecordFromSoakSeries,
  buildValidationOpsRecordFromValidationProfile,
  buildValidationOpsReport,
} from "./validation-ops-inspection";

test("validation ops inspection derives operator-facing records and report counts", () => {
  const releaseRecord = buildValidationOpsRecordFromReleaseReadiness({
    runId: "release-1",
    startedAt: 10,
    completedAt: 30,
    result: {
      status: "failed",
      totalChecks: 2,
      passedChecks: 1,
      failedChecks: 1,
      artifact: null,
      checks: [
        { checkId: "build-cli", title: "Build CLI", status: "passed", details: [] },
        { checkId: "publish-dry-run", title: "Publish dry-run", status: "failed", details: ["failed"] },
      ],
    },
  });

  const profileRecord = buildValidationOpsRecordFromValidationProfile({
    runId: "profile-1",
    startedAt: 40,
    completedAt: 70,
    result: {
      profileId: "nightly",
      title: "Nightly Hardening",
      summary: "nightly",
      focusAreas: ["browser"],
      validationSelectors: ["failure", "acceptance", "realworld", "soak"],
      includeReleaseReadiness: true,
      soakSeriesCycles: 3,
      soakSeriesSelectors: ["soak", "realworld", "acceptance"],
      status: "failed",
      durationMs: 30,
      totalStages: 3,
      passedStages: 1,
      failedStages: 2,
      issues: [
        {
          issueId: "validation-run:realworld:browser-research-recovery-runbook",
          kind: "validation-item",
          stageId: "validation-run",
          scope: "realworld:browser-research-recovery-runbook",
          summary: "[browser] browser research failed 1/5 cases",
        },
      ],
      stages: [],
    },
  });

  const soakRecord = buildValidationOpsRecordFromSoakSeries({
    runId: "soak-1",
    startedAt: 80,
    completedAt: 110,
    selectors: ["soak", "realworld", "acceptance"],
    result: {
      status: "failed",
      selectors: ["soak", "realworld", "acceptance"],
      totalCycles: 3,
      passedCycles: 2,
      failedCycles: 1,
      totalSuites: 9,
      failedSuites: 1,
      totalItems: 12,
      failedItems: 1,
      totalCases: 50,
      failedCases: 1,
      durationMs: 30,
      cycles: [],
      suiteAggregates: [
        {
          suiteId: "realworld",
          cycles: 3,
          failedCycles: 1,
          totalItems: 6,
          failedItems: 1,
          totalCases: 20,
          failedCases: 1,
        },
      ],
    },
  });

  const report = buildValidationOpsReport([releaseRecord, profileRecord, soakRecord], 10);

  assert.equal(report.totalRuns, 3);
  assert.equal(report.failedRuns, 3);
  assert.equal(report.attentionCount, 3);
  assert.equal(report.runTypeCounts["release-readiness"], 1);
  assert.equal(report.runTypeCounts["validation-profile"], 1);
  assert.equal(report.runTypeCounts["soak-series"], 1);
  assert.equal(report.bucketCounts.release, 1);
  assert.equal(report.bucketCounts.browser, 1);
  assert.equal(report.bucketCounts.soak, 1);
  assert.equal(report.severityCounts.critical, 2);
  assert.equal(report.recommendedActionCounts["rerun-release"], 1);
  assert.equal(report.activeIssues[0]?.kind, "validation-item");
  assert.equal(report.activeIssues[0]?.commandHint, "validation-profile-run nightly");
});
