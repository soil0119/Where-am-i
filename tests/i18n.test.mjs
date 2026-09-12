import assert from "node:assert/strict";
import test from "node:test";

import {
  LANGUAGE_STORAGE_KEY,
  localizeText,
  resolveLocale,
  translate,
} from "../app/i18n.ts";

test("resolves Korean browsers and defaults other locales to English", () => {
  assert.equal(resolveLocale("ko-KR"), "ko");
  assert.equal(resolveLocale("en-US"), "en");
  assert.equal(resolveLocale(undefined), "en");
});

test("translates interface messages and interpolation in both languages", () => {
  assert.equal(translate("en", "tagline"), "See where your change leads");
  assert.equal(
    translate("ko", "tagline"),
    "내 변경이 어디로 이어지는지 한눈에",
  );
  assert.equal(
    translate("en", "repoWorkflowLabel", { repo: "sample-api" }),
    "Inspect APIs and workflows for sample-api",
  );
  assert.equal(LANGUAGE_STORAGE_KEY, "whereami-language");
});

test("localizes existing Korean snapshots for English viewers", () => {
  assert.equal(localizeText("en", "내 작업"), "My work");
  assert.equal(
    localizeText("en", "3개 기능 변화 감지"),
    "3 feature changes detected",
  );
  assert.equal(
    localizeText("en", "팀 PR #12, #14 외 2"),
    "Team PRs #12, #14 and 2 more",
  );
});

test("keeps code identifiers and Korean snapshot text intact when appropriate", () => {
  assert.equal(localizeText("en", "POST /api/models"), "POST /api/models");
  assert.equal(localizeText("ko", "내 작업"), "내 작업");
});
