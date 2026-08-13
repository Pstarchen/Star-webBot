import { QQ_OPENAPI_ENDPOINTS } from "../sdk/node/index.mjs";

const DOCUMENTATION_ROOT = "https://bot.q.qq.com";
const SITEMAP_URL = `${DOCUMENTATION_ROOT}/wiki/sitemap.xml`;
const API_PAGE_PATTERN = /<loc>(https:\/\/bot\.q\.qq\.com\/wiki\/develop\/api-v2\/autogen\/api\/[^<]+\.html)<\/loc>/g;

function decodeHtml(value) {
  return value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function tableValue(html, label) {
  const match = html.match(new RegExp(`<tr><td>${label}</td>\\s*<td>(.*?)</td></tr>`, "s"));
  return decodeHtml((match?.[1] || "").replace(/<[^>]+>/g, "").trim());
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

const sitemap = await fetchText(SITEMAP_URL);
const pageUrls = [...sitemap.matchAll(API_PAGE_PATTERN)].map((match) => match[1]);
const documented = [];
for (const pageUrl of pageUrls) {
  const html = await fetchText(pageUrl);
  const method = tableValue(html, "HTTP Method");
  const path = tableValue(html, "HTTP URL") || tableValue(html, "接口地址");
  if (!method || !path) throw new Error(`Cannot parse method/path from ${pageUrl}`);
  documented.push(`${method} ${path}`);
}

const local = Object.values(QQ_OPENAPI_ENDPOINTS).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
const missing = documented.filter((endpoint) => !local.includes(endpoint));
const stale = local.filter((endpoint) => !documented.includes(endpoint));
if (missing.length || stale.length) {
  if (missing.length) console.error("Missing local endpoints:\n" + missing.join("\n"));
  if (stale.length) console.error("Stale local endpoints:\n" + stale.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`QQ OpenAPI catalog matches ${documented.length} generated documentation endpoints.`);
}
