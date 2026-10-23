import assert from "node:assert/strict";
import test from "node:test";
import { isApprovedTemporaryException } from "./production-audit-exceptions.mjs";

const expoForgeFinding = {
  url: "https://github.com/advisories/GHSA-86w9-cpqp-85rv",
  module_name: "node-forge",
  findings: [
    {
      version: "1.4.0",
      paths: [
        "apps__mobile>expo>@expo/cli>node-forge",
        "apps__mobile>expo-updates>@expo/code-signing-certificates>node-forge",
      ],
    },
  ],
};

test("accepts only the known Expo node-forge paths", () => {
  assert.equal(isApprovedTemporaryException(expoForgeFinding), true);
  assert.equal(
    isApprovedTemporaryException({
      ...expoForgeFinding,
      findings: [{ version: "1.4.1", paths: expoForgeFinding.findings[0].paths }],
    }),
    false,
  );
  assert.equal(
    isApprovedTemporaryException({
      ...expoForgeFinding,
      findings: [{ version: "1.4.0", paths: ["apps__web>node-forge"] }],
    }),
    false,
  );
  assert.equal(
    isApprovedTemporaryException({ ...expoForgeFinding, module_name: "another-package" }),
    false,
  );
  assert.equal(isApprovedTemporaryException({ ...expoForgeFinding, findings: [] }), false);
});
