import type { OrgDlpPolicy } from "@/lib/org-settings";

const DEFAULT_PATTERNS = [
  "\\b[\\w.%+-]+@[\\w.-]+\\.[A-Za-z]{2,}\\b", // email
  "\\b\\+?\\d{1,3}[\\s-]?(?:\\(\\d{2,4}\\)|\\d{2,4})[\\s-]?\\d{3,4}[\\s-]?\\d{2,4}\\b", // phone
  "\\b(?:\\d[ -]*?){13,19}\\b", // card
  "\\b\\d{3}-\\d{2}-\\d{4}\\b", // US SSN
  "\\b[A-Z]{2}\\d{2}[A-Z0-9]{11,30}\\b" // IBAN
];

export type DlpOutcome = {
  action: "allow" | "block" | "redact";
  redactedText?: string;
  matches: string[];
};

function buildRegexList(patterns: string[]) {
  const list: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      list.push(new RegExp(pattern, "gi"));
    } catch {
      // Skip invalid regex patterns.
    }
  }
  return list;
}

export function evaluateDlp(text: string, policy: OrgDlpPolicy): DlpOutcome {
  if (!policy.enabled) {
    return { action: "allow", matches: [] };
  }

  const patterns = policy.patterns.length ? policy.patterns : DEFAULT_PATTERNS;
  const regexes = buildRegexList(patterns);

  const matches: string[] = [];
  let redacted = text;

  for (const regex of regexes) {
    const localMatches = [...text.matchAll(regex)].map((match) => match[0]);
    if (localMatches.length) {
      matches.push(...localMatches);
      if (policy.action === "redact") {
        redacted = redacted.replace(regex, "[REDACTED]");
      }
    }
  }

  if (!matches.length) {
    return { action: "allow", matches: [] };
  }

  if (policy.action === "redact") {
    return { action: "redact", matches, redactedText: redacted };
  }

  return { action: "block", matches };
}
