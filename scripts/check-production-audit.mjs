import { spawnSync } from "node:child_process";

const reviewBy = new Date("2026-11-15T00:00:00Z");
const temporaryExceptions = new Map([
  [
    "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
    "Expo/Metro currently resolves braces 3.0.3; npm has not published the advised 3.0.4 fix.",
  ],
  [
    "https://github.com/advisories/GHSA-86w9-cpqp-85rv",
    "Expo CLI currently resolves node-forge 1.4.0; npm has not published the advised 1.4.1 fix.",
  ],
]);

const result = spawnSync("pnpm", ["audit", "--prod", "--json"], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

if (result.error) {
  console.error(`Could not run pnpm audit: ${result.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("pnpm audit did not return valid JSON.");
  console.error(result.stderr || result.stdout);
  process.exit(1);
}

const blockedSeverities = new Set(["moderate", "high", "critical"]);
const advisories = Object.values(report.advisories ?? {});
const blocked = advisories.filter(
  (advisory) =>
    blockedSeverities.has(advisory.severity) &&
    !temporaryExceptions.has(advisory.url),
);
const known = advisories.filter((advisory) => temporaryExceptions.has(advisory.url));

if (blocked.length > 0) {
  console.error("Production dependency audit found unapproved advisories:");
  for (const advisory of blocked) {
    console.error(`- ${advisory.severity}: ${advisory.module_name} — ${advisory.url}`);
  }
  process.exit(1);
}

if (known.length > 0 && Date.now() >= reviewBy.getTime()) {
  console.error(
    `Temporary audit exceptions expired on ${reviewBy.toISOString().slice(0, 10)}. Re-check Expo's dependency releases before renewing them.`,
  );
  process.exit(1);
}

for (const advisory of known) {
  console.warn(
    `Temporary exception: ${advisory.module_name} (${advisory.url}) — ${temporaryExceptions.get(advisory.url)}`,
  );
}

console.log(
  `Production dependency audit passed: ${blocked.length} unapproved moderate-or-higher advisories.`,
);
