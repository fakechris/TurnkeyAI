import assert from "node:assert/strict";
import test from "node:test";

import type { ReleaseReadinessResult } from "./release-readiness";
import type { ValidationRunResult } from "./validation-suite";
import type { ValidationSoakSeriesResult } from "./validation-soak-series";
import {
  isValidationProfileId,
  listValidationProfiles,
  runValidationProfile,
  summarizeValidationProfileResult,
  summarizeValidationStage,
} from "./validation-profile";

test("validation profiles list built-in hardening profiles", () => {
  const profiles = listValidationProfiles();

  assert.deepEqual(
    profiles.map((profile) => profile.profileId),
    ["smoke", "nightly", "prerelease", "weekly"]
  );
  assert.ok(profiles.find((profile) => profile.profileId === "nightly")?.includeReleaseReadiness);
  assert.deepEqual(
    profiles.find((profile) => profile.profileId === "weekly")?.soakSeriesSelectors,
    ["soak", "realworld", "acceptance"]
  );
});

test("validation profile id guard accepts known profiles", () => {
  assert.equal(isValidationProfileId("smoke"), true);
  assert.equal(isValidationProfileId("weekly"), true);
  assert.equal(isValidationProfileId("unknown"), false);
});

test("smoke validation profile only runs validation catalog stage", async () => {
  let releaseCalls = 0;
  let soakCalls = 0;
  const result = await runValidationProfile(
    "smoke",
    {},
    {
      releaseReadinessRunner: async () => {
        releaseCalls += 1;
        return makeReleaseReadinessResult();
      },
      validationRunner: () => makeValidationRunResult(),
      soakSeriesRunner: () => {
        soakCalls += 1;
        return makeValidationSoakSeriesResult();
      },
    }
  );

  assert.equal(result.status, "passed");
  assert.equal(result.totalStages, 1);
  assert.equal(result.stages[0]?.stageId, "validation-run");
  assert.equal(releaseCalls, 0);
  assert.equal(soakCalls, 0);
  assert.match(summarizeValidationProfileResult(result), /stages=1\/1/);
  assert.match(summarizeValidationStage(result.stages[0]!), /suites=1\/1/);
});

test("nightly validation profile aggregates validation, release, and soak failures", async () => {
  const result = await runValidationProfile(
    "nightly",
    {},
    {
      releaseReadinessRunner: async () =>
        makeReleaseReadinessResult({
          status: "failed",
          passedChecks: 1,
          failedChecks: 1,
          checks: [
            { checkId: "pack-cli", title: "Pack CLI", status: "passed", details: [] },
            { checkId: "publish-dry-run", title: "Publish dry-run", status: "failed", details: ["dry-run failed"] },
          ],
        }),
      validationRunner: () =>
        makeValidationRunResult({
          failedSuites: 1,
          passedSuites: 1,
          failedItems: 1,
          passedItems: 1,
          failedCases: 1,
          passedCases: 3,
          suites: [
            {
              suiteId: "acceptance",
              title: "Acceptance",
              summary: "acceptance",
              totalItems: 1,
              passedItems: 0,
              failedItems: 1,
              totalCases: 2,
              passedCases: 1,
              failedCases: 1,
              items: [
                {
                  suiteId: "acceptance",
                  itemId: "browser-ownership-reclaim-isolation",
                  area: "browser",
                  title: "Ownership reclaim",
                  summary: "summary",
                  status: "failed",
                  totalCases: 2,
                  passedCases: 1,
                  failedCases: 1,
                  caseResults: [],
                },
              ],
            },
          ],
        }),
      soakSeriesRunner: () =>
        makeValidationSoakSeriesResult({
          status: "failed",
          totalCycles: 3,
          passedCycles: 2,
          failedCycles: 1,
          totalCases: 30,
          failedCases: 2,
          suiteAggregates: [
            {
              suiteId: "soak",
              cycles: 3,
              failedCycles: 1,
              totalItems: 9,
              failedItems: 1,
              totalCases: 30,
              failedCases: 2,
            },
          ],
        }),
    }
  );

  assert.equal(result.status, "failed");
  assert.equal(result.totalStages, 3);
  assert.equal(result.issues.length, 3);
  assert.ok(result.issues.some((issue) => issue.kind === "validation-item" && issue.scope === "acceptance:browser-ownership-reclaim-isolation"));
  assert.ok(result.issues.some((issue) => issue.kind === "release-check" && issue.scope === "publish-dry-run"));
  assert.ok(result.issues.some((issue) => issue.kind === "soak-suite" && issue.scope === "soak"));
});

function makeValidationRunResult(
  overrides: Partial<ValidationRunResult> = {}
): ValidationRunResult {
  return {
    totalSuites: 1,
    passedSuites: 1,
    failedSuites: 0,
    totalItems: 1,
    passedItems: 1,
    failedItems: 0,
    totalCases: 2,
    passedCases: 2,
    failedCases: 0,
    suites: [
      {
        suiteId: "realworld",
        title: "Realworld",
        summary: "realworld",
        totalItems: 1,
        passedItems: 1,
        failedItems: 0,
        totalCases: 2,
        passedCases: 2,
        failedCases: 0,
        items: [
          {
            suiteId: "realworld",
            itemId: "browser-research-recovery-runbook",
            area: "browser",
            title: "Browser research",
            summary: "summary",
            status: "passed",
            totalCases: 2,
            passedCases: 2,
            failedCases: 0,
            caseResults: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeReleaseReadinessResult(
  overrides: Partial<ReleaseReadinessResult> = {}
): ReleaseReadinessResult {
  return {
    status: "passed",
    totalChecks: 2,
    passedChecks: 2,
    failedChecks: 0,
    artifact: {
      filename: "turnkeyai-cli.tgz",
      totalFiles: 10,
    },
    checks: [
      { checkId: "pack-cli", title: "Pack CLI", status: "passed", details: [] },
      { checkId: "publish-dry-run", title: "Publish dry-run", status: "passed", details: [] },
    ],
    ...overrides,
  };
}

function makeValidationSoakSeriesResult(
  overrides: Partial<ValidationSoakSeriesResult> = {}
): ValidationSoakSeriesResult {
  return {
    status: "passed",
    selectors: ["soak", "realworld", "acceptance"],
    totalCycles: 3,
    passedCycles: 3,
    failedCycles: 0,
    totalSuites: 9,
    failedSuites: 0,
    totalItems: 18,
    failedItems: 0,
    totalCases: 30,
    failedCases: 0,
    durationMs: 12,
    cycles: [],
    suiteAggregates: [
      {
        suiteId: "soak",
        cycles: 3,
        failedCycles: 0,
        totalItems: 9,
        failedItems: 0,
        totalCases: 30,
        failedCases: 0,
      },
    ],
    ...overrides,
  };
}
