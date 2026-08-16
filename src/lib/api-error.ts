type ApiErrorBody = {
  message?: unknown;
  code?: unknown;
  detail?: unknown;
};

function text(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : "";
}

export function formatApiError(body: unknown, fallback = "请求失败") {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fallback;
  const error = body as ApiErrorBody;
  const rawCode = text(error.code, 1_000);
  const codeMatch = rawCode.match(/^([A-Z][A-Z0-9_]*)(?::([\s\S]*))?$/);
  const code = codeMatch?.[1] || "";
  const detail = text(error.detail, 500) || text(codeMatch?.[2], 500);
  const message = text(error.message, 200) || code || fallback;

  if (!code || message === code) return detail ? `${message}：${detail}` : message;
  return detail ? `${message}（${code}）：${detail}` : `${message}（${code}）`;
}
