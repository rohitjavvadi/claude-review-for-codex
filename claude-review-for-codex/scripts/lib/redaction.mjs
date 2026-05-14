const SECRET_PATTERNS = [
  {
    name: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    name: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  },
  {
    name: "basic-auth",
    pattern: /\bBasic\s+[A-Za-z0-9+/=]{12,}/gi,
  },
  {
    name: "anthropic-key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    name: "openai-key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    name: "assignment-secret",
    pattern: /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*([A-Za-z0-9._~+/=-]{8,}|"[^"]{8,}"|'[^']{8,}')/g,
    replace: "$1=[REDACTED]",
  },
  {
    name: "json-secret",
    pattern: /"([^"]*(?:token|secret|password|api_key|private_key|access_key)[^"]*)"\s*:\s*"[^"]+"/gi,
    replace: "\"$1\":\"[REDACTED]\"",
  },
  {
    name: "credential-url",
    pattern: /(https?:\/\/)([^:@/\s]+):([^@/\s]+)@/gi,
    replace: "$1[REDACTED]@",
  },
];

export function redactText(input) {
  let text = String(input ?? "");
  const hits = new Map();

  for (const rule of SECRET_PATTERNS) {
    text = text.replace(rule.pattern, (...args) => {
      hits.set(rule.name, (hits.get(rule.name) ?? 0) + 1);
      if (rule.replace) {
        return rule.replace.replace(/\$(\d+)/g, (_, index) => args[Number(index)] ?? "");
      }
      return "[REDACTED]";
    });
  }

  return {
    text,
    redactions: [...hits.entries()].map(([type, count]) => ({ type, count })),
  };
}

export function redactJson(value) {
  const hits = new Map();
  const valueOut = redactValue(value, hits);
  return {
    value: valueOut,
    redactions: [...hits.entries()].map(([type, count]) => ({ type, count })),
  };
}

function redactValue(value, hits) {
  if (typeof value === "string") {
    const redacted = redactText(value);
    for (const item of redacted.redactions) {
      hits.set(item.type, (hits.get(item.type) ?? 0) + item.count);
    }
    return redacted.text;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, hits));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item, hits)])
    );
  }
  return value;
}
