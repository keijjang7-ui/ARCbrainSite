const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 8788);
const ROOT = __dirname;
const INDEX_PATH = path.join(ROOT, "index.html");
const EDITOR_PATH = path.join(ROOT, "text-editor.html");

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

const ATTRIBUTES_TO_EDIT = new Set([
  "alt",
  "aria-label",
  "data-title",
  "data-copy",
  "placeholder",
  "title"
]);

const GROUP_LABELS = {
  header: "Header",
  hero: "Hero",
  problem: "Problem",
  solution: "Platform",
  features: "Features",
  usecases: "Solutions",
  trust: "Trust",
  cta: "Contact",
  footer: "Footer",
  document: "Document"
};

const GENERIC_CLASSES = new Set([
  "section",
  "section-light",
  "section-dark",
  "section-parchment",
  "container",
  "reveal",
  "in",
  "delay-1",
  "delay-2",
  "delay-3",
  "delay-4",
  "delay-5"
]);

function buildSkipRanges(html) {
  const ranges = [];
  ["script", "style", "template", "noscript"].forEach((tag) => {
    const pattern = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi");
    let match;
    while ((match = pattern.exec(html))) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  });
  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

function isInsideRange(position, ranges) {
  return ranges.some((range) => position >= range.start && position < range.end);
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };

  return String(value).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body) => {
    const lower = body.toLowerCase();
    if (lower.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    }
    if (lower.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    }
    return Object.prototype.hasOwnProperty.call(named, lower) ? named[lower] : entity;
  });
}

function escapeText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseAttributes(tag) {
  const attrs = {};
  const matches = [];
  const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;

  while ((match = attrPattern.exec(tag))) {
    const name = match[1].toLowerCase();
    const rawValue = match[3] ?? match[4] ?? "";
    attrs[name] = rawValue;
    matches.push({
      name,
      rawValue,
      valueOffset: match.index + match[0].indexOf(match[2]) + 1
    });
  }

  return { attrs, matches };
}

function preferredClass(className = "") {
  const classes = className.split(/\s+/).filter(Boolean);
  return classes.find((item) => !GENERIC_CLASSES.has(item)) || classes[0] || "";
}

function groupFromStack(stack) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const item = stack[index];
    const classes = item.attrs.class || "";
    const bestClass = preferredClass(classes);

    if (
      item.name === "header" ||
      item.name === "nav" ||
      classes.split(/\s+/).includes("site-header") ||
      classes.split(/\s+/).includes("nav")
    ) {
      return { key: "header", label: GROUP_LABELS.header };
    }
    if (item.name === "footer" || classes.split(/\s+/).includes("site-footer")) {
      return { key: "footer", label: GROUP_LABELS.footer };
    }
    if (item.name === "section") {
      const key = item.attrs.id || bestClass || "document";
      return { key, label: GROUP_LABELS[key] || titleCase(key) };
    }
    if (bestClass === "mobile-menu") {
      return { key: "header", label: GROUP_LABELS.header };
    }
  }

  return { key: "document", label: GROUP_LABELS.document };
}

function labelFromStack(stack, attrName = "") {
  const interesting = new Set([
    "h1",
    "h2",
    "h3",
    "p",
    "a",
    "button",
    "span",
    "small",
    "strong",
    "dt",
    "dd",
    "li"
  ]);
  const nearest = [...stack].reverse().find((item) => interesting.has(item.name));
  const base = nearest ? nearest.name.toUpperCase() : "TEXT";
  return attrName ? `${base} attribute: ${attrName}` : base;
}

function titleCase(value) {
  return String(value)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function summarize(value) {
  const compact = String(value).replace(/\s+/g, " ").trim();
  return compact.length > 84 ? `${compact.slice(0, 81)}...` : compact;
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function duplicateKey(entry) {
  const value = String(entry.value).replace(/\s+/g, " ").trim();
  return entry.kind === "attribute"
    ? `attribute:${entry.attr}:${value}`
    : `text:${value}`;
}

function groupDuplicateEntries(entries) {
  const buckets = new Map();

  entries.forEach((entry) => {
    const key = duplicateKey(entry);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(entry);
  });

  let sharedCount = 0;
  return Array.from(buckets.values()).map((members) => {
    const first = members[0];
    const memberIds = members.map((entry) => entry.id);
    const groups = uniqueValues(members.map((entry) => entry.group));
    const groupLabels = uniqueValues(members.map((entry) => entry.groupLabel));
    const groupLabelsByKey = groups.reduce((labelsByKey, groupKey) => {
      const member = members.find((entry) => entry.group === groupKey);
      labelsByKey[groupKey] = member?.groupLabel || titleCase(groupKey);
      return labelsByKey;
    }, {});
    const labels = uniqueValues(members.map((entry) => entry.label));
    const isShared = members.length > 1;

    if (isShared) {
      sharedCount += 1;
    }

    return {
      id: isShared ? `shared-${sharedCount}` : first.id,
      memberIds,
      kind: first.kind,
      group: first.group,
      groupLabel: first.groupLabel,
      groups,
      groupLabels,
      groupLabelsByKey,
      label: labels.length > 1 ? `${labels[0]} + ${labels.length - 1} more` : first.label,
      labels,
      summary: first.summary,
      value: first.value,
      occurrenceCount: members.length,
      attr: first.attr || ""
    };
  });
}

function extractEntries(html) {
  const skipRanges = buildSkipRanges(html);
  const tokenPattern = /<[^>]*>|[^<]+/g;
  const stack = [];
  const entries = [];
  let textCount = 0;
  let attrCount = 0;
  let match;

  while ((match = tokenPattern.exec(html))) {
    const token = match[0];
    const tokenStart = match.index;

    if (isInsideRange(tokenStart, skipRanges)) {
      continue;
    }

    if (token.startsWith("<")) {
      if (/^<!--/.test(token) || /^<!doctype/i.test(token) || /^<\?/.test(token)) {
        continue;
      }

      const tagNameMatch = token.match(/^<\/?\s*([a-zA-Z0-9:-]+)/);
      if (!tagNameMatch) {
        continue;
      }

      const tagName = tagNameMatch[1].toLowerCase();
      const isClosing = /^<\//.test(token);

      if (isClosing) {
        for (let index = stack.length - 1; index >= 0; index -= 1) {
          const item = stack.pop();
          if (item.name === tagName) break;
        }
        continue;
      }

      const { attrs, matches } = parseAttributes(token);
      const item = { name: tagName, attrs };
      const contextStack = stack.concat(item);
      const group = groupFromStack(contextStack);

      matches.forEach((attr) => {
        if (!ATTRIBUTES_TO_EDIT.has(attr.name)) return;
        if (!/\S/.test(attr.rawValue)) return;

        attrCount += 1;
        const valueStart = tokenStart + attr.valueOffset;
        const valueEnd = valueStart + attr.rawValue.length;
        const value = decodeEntities(attr.rawValue);

        entries.push({
          id: `attr-${attrCount}`,
          kind: "attribute",
          group: group.key,
          groupLabel: group.label,
          label: labelFromStack(contextStack, attr.name),
          summary: summarize(value),
          value,
          start: valueStart,
          end: valueEnd,
          attr: attr.name
        });
      });

      const selfClosing = /\/\s*>$/.test(token) || VOID_TAGS.has(tagName);
      if (!selfClosing) {
        stack.push(item);
      }
      continue;
    }

    if (!/\S/.test(token)) {
      continue;
    }

    const leading = token.match(/^\s*/)[0];
    const trailing = token.match(/\s*$/)[0];
    const core = token.slice(leading.length, token.length - trailing.length);
    if (!/\S/.test(core)) {
      continue;
    }

    textCount += 1;
    const group = groupFromStack(stack);
    const value = decodeEntities(core.replace(/\s+/g, " "));

    entries.push({
      id: `text-${textCount}`,
      kind: "text",
      group: group.key,
      groupLabel: group.label,
      label: labelFromStack(stack),
      summary: summarize(value),
      value,
      start: tokenStart,
      end: tokenStart + token.length,
      prefix: leading,
      suffix: trailing
    });
  }

  return entries;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, data) {
  const payload = JSON.stringify(data, null, 2);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function sendText(response, status, data, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(data)
  });
  response.end(data);
}

function indexVersion(html) {
  return crypto.createHash("sha256").update(html).digest("hex");
}

function saveTextUpdates(updates, expectedVersion) {
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  const currentVersion = indexVersion(html);

  if (expectedVersion && expectedVersion !== currentVersion) {
    return {
      changed: false,
      stale: true,
      version: currentVersion,
      updateCount: 0
    };
  }

  const entries = extractEntries(html);
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
  const replacements = [];
  const updatedIds = new Set();

  updates.forEach((update) => {
    const memberIds =
      Array.isArray(update.memberIds) && update.memberIds.length
        ? update.memberIds
        : [update.id];
    const value = String(update.value ?? "").replace(/\r\n/g, "\n");

    memberIds.forEach((memberId) => {
      if (updatedIds.has(memberId)) return;

      const entry = entryMap.get(memberId);
      if (!entry) return;
      if (value === entry.value) return;

      const replacement =
        entry.kind === "attribute"
          ? escapeAttribute(value)
          : `${entry.prefix}${escapeText(value)}${entry.suffix}`;

      replacements.push({
        start: entry.start,
        end: entry.end,
        replacement
      });
      updatedIds.add(memberId);
    });
  });

  replacements.sort((a, b) => b.start - a.start);

  let nextHtml = html;
  replacements.forEach((item) => {
    nextHtml = `${nextHtml.slice(0, item.start)}${item.replacement}${nextHtml.slice(item.end)}`;
  });

  if (nextHtml !== html) {
    fs.writeFileSync(INDEX_PATH, nextHtml, "utf8");
  }

  return {
    changed: nextHtml !== html,
    entryCount: entries.length,
    updateCount: replacements.length,
    version: indexVersion(nextHtml)
  };
}

async function handleApi(request, response, url) {
  try {
    if (request.method === "GET" && url.pathname === "/api/texts") {
      const html = fs.readFileSync(INDEX_PATH, "utf8");
      const stats = fs.statSync(INDEX_PATH);
      const extractedEntries = extractEntries(html);
      const groupedEntries = groupDuplicateEntries(extractedEntries);
      sendJson(response, 200, {
        entries: groupedEntries,
        rawEntryCount: extractedEntries.length,
        indexPath: INDEX_PATH,
        version: indexVersion(html),
        updatedAt: stats.mtime.toISOString()
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/save") {
      const body = await readRequestBody(request);
      const data = JSON.parse(body || "{}");
      const result = saveTextUpdates(Array.isArray(data.entries) ? data.entries : [], data.version);
      sendJson(response, result.stale ? 409 : 200, result);
      return;
    }

    sendJson(response, 404, { error: "Unknown API route." });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

function serveFile(response, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    sendText(response, 404, "Not found");
    return;
  }
  sendText(response, 200, fs.readFileSync(filePath), contentType);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);

  if (url.pathname.startsWith("/api/")) {
    handleApi(request, response, url);
    return;
  }

  if (request.method !== "GET") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  if (url.pathname === "/" || url.pathname === "/text-editor.html") {
    serveFile(response, EDITOR_PATH, "text/html; charset=utf-8");
    return;
  }

  if (url.pathname === "/index.html") {
    serveFile(response, INDEX_PATH, "text/html; charset=utf-8");
    return;
  }

  sendText(response, 404, "Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Text editor: http://${HOST}:${PORT}/text-editor.html`);
});
