import assert from "node:assert/strict";
import test from "node:test";

import type { ReleaseReadinessResult } from "./release-readiness";
import type { ValidationRunResult, ValidationSuiteId } from "./validation-suite";
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
  assert.equal(isValidationProfileId("constructor"), false);
  assert.equal(isValidationProfileId("__proto__"), false);
});

test("smoke validation profile only runs validation catalog stage", async () => {
  let releaseCalls = 0;
  const validationCalls: string[][] = [];
  const result = await runValidationProfile(
    "smoke",
    {},
    {
      releaseReadinessRunner: async () => {
        releaseCalls += 1;
        return makeReleaseReadinessResult();
      },
      validationRunner: (selectors) => {
        validationCalls.push([...(selectors ?? [])]);
        return makeSuiteScopedValidationRunResult(selectors);
      },
    }
  );

  assert.equal(result.status, "passed");
  assert.equal(result.totalStages, 1);
  assert.equal(result.stages[0]?.stageId, "validation-run");
  assert.equal(releaseCalls, 0);
  assert.deepEqual(validationCalls, [
    ["regression:browser-recovery-cold-reopen-outcome", "regression:runtime-prompt-console-summarizes-boundaries", "regression:governance-publish-readback-verifies-closure"],
    ["acceptance:browser-ownership-reclaim-isolation"],
    ["realworld:browser-research-recovery-runbook", "realworld:governed-publish-readback-verification"],
  ]);
  assert.match(summarizeValidationProfileResult(result), /stages=1\/1/);
  assert.match(summarizeValidationStage(result.stages[0]!), /suites=3\/3/);
});

test("nightly validation profile aggregates validation, release, and soak failures", async () => {
  let validationStageCalls = 0;
  const validationCalls: string[][] = [];
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
      validationRunner: (selectors) => {
        validationCalls.push([...(selectors ?? [])]);
        const suiteId = getSuiteIdFromSelectors(selectors);
        if (validationStageCalls < 4 && suiteId === "acceptance") {
          validationStageCalls += 1;
          return makeSuiteScopedValidationRunResult(selectors, { suiteId, failed: true });
        }
        validationStageCalls += 1;
        if (suiteId === "soak" && validationStageCalls > 4) {
          return makeSuiteScopedValidationRunResult(selectors, { suiteId, failed: true });
        }
        return makeSuiteScopedValidationRunResult(selectors, { suiteId });
      },
    }
  );

  assert.equal(result.status, "failed");
  assert.equal(result.totalStages, 3);
  assert.equal(result.issues.length, 3);
  assert.deepEqual(validationCalls.slice(0, 4), [
    ["failure"],
    ["acceptance"],
    ["realworld"],
    ["soak"],
  ]);
  assert.deepEqual(validationCalls.slice(4, 7), [
    ["soak"],
    ["realworld"],
    ["acceptance"],
  ]);
  assert.ok(result.issues.some((issue) => issue.kind === "validation-item" && issue.scope === "acceptance:browser-ownership-reclaim-isolation"));
  assert.ok(result.issues.some((issue) => issue.kind === "release-check" && issue.scope === "publish-dry-run"));
  assert.ok(result.issues.some((issue) => issue.kind === "soak-suite" && issue.scope === "soak"));
});

function makeSuiteScopedValidationRunResult(
  selectors?: string[],
  options: {
    suiteId?: ValidationSuiteId;
    failed?: boolean;
  } = {}
): ValidationRunResult {
  const suiteId = options.suiteId ?? getSuiteIdFromSelectors(selectors);
  const failed = options.failed ?? false;
  const itemId = suiteId === "acceptance"
    ? "browser-ownership-reclaim-isolation"
    : suiteId === "realworld"
      ? "browser-research-recovery-runbook"
      : `${suiteId}-sample`;
  const itemTitle = suiteId === "acceptance" ? "Ownership reclaim" : `${suiteId} scenario`;
  const area = suiteId === "acceptance" || suiteId === "realworld" ? "browser" : suiteId;
  const totalCases = failed ? 2 : 2;
  const failedCases = failed ? 1 : 0;
  const passedCases = totalCases - failedCases;
  const totalItems = 1;
  const failedItems = failed ? 1 : 0;
  const passedItems = totalItems - failedItems;

  return {
    totalSuites: 1,
    passedSuites: failed ? 0 : 1,
    failedSuites: failed ? 1 : 0,
    totalItems,
    passedItems,
    failedItems,
    totalCases,
    passedCases,
    failedCases,
    suites: [
      {
        suiteId,
        title: suiteId[0]!.toUpperCase() + suiteId.slice(1),
        summary: suiteId,
        totalItems,
        passedItems,
        failedItems,
        totalCases,
        passedCases,
        failedCases,
        items: [
          {
            suiteId,
            itemId,
            area,
            title: itemTitle,
            summary: "summary",
            status: failed ? "failed" : "passed",
            totalCases,
            passedCases,
            failedCases,
            caseResults: [],
          },
        ],
      },
    ],
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

function getSuiteIdFromSelectors(selectors?: string[]): ValidationSuiteId {
  const firstSelector = selectors?.[0];
  const prefix = firstSelector?.split(":", 1)[0];
  switch (prefix) {
    case "regression":
    case "soak":
    case "failure":
    case "acceptance":
    case "realworld":
      return prefix;
    default:
      return "realworld";
  }
}
