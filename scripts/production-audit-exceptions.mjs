const expoForgeAdvisory = "https://github.com/advisories/GHSA-86w9-cpqp-85rv";

export function isApprovedTemporaryException(advisory) {
  if (advisory.url === "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm") {
    return advisory.module_name === "braces";
  }

  if (advisory.url !== expoForgeAdvisory || advisory.module_name !== "node-forge") {
    return false;
  }

  const findings = advisory.findings;
  return (
    Array.isArray(findings) &&
    findings.length > 0 &&
    findings.every(
      (finding) =>
        finding.version === "1.4.0" &&
        Array.isArray(finding.paths) &&
        finding.paths.length > 0 &&
        finding.paths.every(
          (path) =>
            typeof path === "string" &&
            path.startsWith("apps__mobile>") &&
            path.endsWith(">node-forge") &&
            (path.includes(">@expo/cli>") ||
              path.includes(">expo-updates>@expo/code-signing-certificates>")),
        ),
    )
  );
}
