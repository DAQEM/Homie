function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed) || trimmed.startsWith("/")) {
    return trimmed;
  }
  return null;
}

function formatInlineTextOnly(raw: string): string {
  let out = escapeHtml(raw);
  out = out.replace(/\*\*\*([\s\S]+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([\s\S]+?)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^\w*])\*([^\s*](?:[^*]*[^\s*])?)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^\w_])_([^\s_](?:[^_]*[^\s_])?)_/g, "$1<em>$2</em>");
  out = out.replace(/~~([\s\S]+?)~~/g, "<s>$1</s>");
  return out;
}

function formatInlineMarkdown(raw: string): string {
  const codeTokens: string[] = [];
  const withCodePlaceholders = raw.replace(/`([^`]+)`/g, (_m, code: string) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000CODE${idx}\u0000`;
  });

  const linkTokens: string[] = [];
  const withLinkPlaceholders = withCodePlaceholders.replace(
    /\[([^\]]+)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g,
    (full, label: string, target: string) => {
      const urlOnly = target.replace(/\s+"[^"]*"$/, "").trim();
      const safe = sanitizeHref(urlOnly);
      if (!safe) return full;
      const idx = linkTokens.length;
      const renderedLabel = formatInlineTextOnly(label);
      linkTokens.push(
        `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${renderedLabel}</a>`,
      );
      return `\u0000LINK${idx}\u0000`;
    },
  );

  let html = formatInlineTextOnly(withLinkPlaceholders);

  // Auto-link bare URLs not already inside markdown links or code spans
  html = html.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/gi, (_m, prefix: string, urlStr: string) => {
    const trailing = urlStr.match(/[.,!?;:]+$/)?.[0] ?? "";
    const cleanUrl = trailing ? urlStr.slice(0, -trailing.length) : urlStr;
    return `${prefix}<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${trailing}`;
  });

  html = html.replace(/\u0000LINK(\d+)\u0000/g, (_m, idx: string) => linkTokens[Number(idx)] ?? "");
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_m, idx: string) => codeTokens[Number(idx)] ?? "");

  return html;
}

function isBlockStarter(line: string): boolean {
  return (
    /^\s*```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line)
  );
}

/**
 * Converts Markdown (with full multi-line support) into TipTap-compatible HTML.
 */
export function markdownToHtml(md: string): string {
  const normalized = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.trim()) return "";

  const lines = normalized.split("\n");
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block
    if (/^\s*```/.test(line)) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${formatInlineMarkdown(headingMatch[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push("<hr>");
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(`<blockquote>${markdownToHtml(quoteLines.join("\n"))}</blockquote>`);
      continue;
    }

    // Task list (- [ ] / - [x])
    if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
        if (!m) break;
        const checked = m[1].toLowerCase() === "x";
        items.push(
          `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked ? ' checked="checked"' : ""}><span></span></label><div><p>${formatInlineMarkdown(m[2])}</p></div></li>`,
        );
        i++;
      }
      blocks.push(`<ul data-type="taskList">${items.join("")}</ul>`);
      continue;
    }

    // Unordered list (- / * / +)
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*+]\s+(.*)$/);
        if (!m || /^\s*[-*+]\s+\[[ xX]\]\s+/.test(lines[i])) break;
        items.push(`<li><p>${formatInlineMarkdown(m[1])}</p></li>`);
        i++;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list (1. / 2. / ...)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+\.\s+(.*)$/);
        if (!m) break;
        items.push(`<li><p>${formatInlineMarkdown(m[1])}</p></li>`);
        i++;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Multi-line paragraph (single newlines preserved as <br>)
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !isBlockStarter(lines[i])) {
      paraLines.push(formatInlineMarkdown(lines[i]));
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(`<p>${paraLines.join("<br>")}</p>`);
    }
  }

  return blocks.join("");
}

function serializeHtmlNode(node: Node, listDepth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === "br") {
    return "\n";
  }

  if (tag === "hr") {
    return "\n---\n\n";
  }

  if (tag === "pre") {
    const codeText = (el.textContent ?? "").replace(/^\n+|\n+$/g, "");
    return `\n\`\`\`\n${codeText}\n\`\`\`\n\n`;
  }

  if (tag === "code") {
    if (el.parentElement?.tagName.toLowerCase() === "pre") {
      return el.textContent ?? "";
    }
    return `\`${el.textContent ?? ""}\``;
  }

  if (tag === "ul" || tag === "ol") {
    const isTaskList = el.getAttribute("data-type") === "taskList";
    const items: string[] = [];
    let ord = 1;
    const indent = "  ".repeat(listDepth);

    for (const child of Array.from(el.children)) {
      if (child.tagName.toLowerCase() !== "li") continue;
      const liEl = child as HTMLElement;

      const innerParts: string[] = [];
      const nestedLists: string[] = [];
      for (const liChild of Array.from(liEl.childNodes)) {
        if (liChild.nodeType === Node.ELEMENT_NODE) {
          const childTag = (liChild as HTMLElement).tagName.toLowerCase();
          if (childTag === "label" && isTaskList) {
            continue;
          }
          if (childTag === "ul" || childTag === "ol") {
            nestedLists.push(serializeHtmlNode(liChild, listDepth + 1).replace(/\n+$/, ""));
            continue;
          }
        }
        innerParts.push(serializeHtmlNode(liChild, listDepth));
      }

      const content = innerParts.join("").replace(/\n+/g, " ").trim();
      if (isTaskList || liEl.getAttribute("data-type") === "taskItem") {
        const checked = liEl.getAttribute("data-checked") === "true";
        items.push(`${indent}- [${checked ? "x" : " "}] ${content}`);
      } else if (tag === "ol") {
        items.push(`${indent}${ord}. ${content}`);
        ord++;
      } else {
        items.push(`${indent}- ${content}`);
      }

      for (const nested of nestedLists) {
        if (nested.trim()) items.push(nested);
      }
    }

    return items.join("\n") + (listDepth === 0 ? "\n\n" : "\n");
  }

  const inner = Array.from(el.childNodes)
    .map((child) => serializeHtmlNode(child, listDepth))
    .join("");

  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(tag[1]);
      return `${"#".repeat(level)} ${inner.trim()}\n\n`;
    }
    case "p":
    case "div": {
      const parentTag = el.parentElement?.tagName.toLowerCase();
      if (parentTag === "li") {
        return inner;
      }
      if (inner.trim() === "") {
        return "\n";
      }
      return `${inner}\n\n`;
    }
    case "strong":
    case "b":
      return inner ? `**${inner}**` : "";
    case "em":
    case "i":
      return inner ? `*${inner}*` : "";
    case "s":
    case "del":
    case "strike":
      return inner ? `~~${inner}~~` : "";
    case "blockquote": {
      const lines = inner
        .trim()
        .split("\n")
        .map((l) => (l.trim() === "" ? ">" : `> ${l}`));
      return `${lines.join("\n")}\n\n`;
    }
    case "a": {
      const href = el.getAttribute("href")?.trim() ?? "";
      const label = inner.trim();
      if (!href || href === label) return label || href;
      return `[${label}](${href})`;
    }
    default:
      return inner;
  }
}

/**
 * Converts TipTap HTML (from Vikunja) or raw plain text/Markdown back into clean multi-line Markdown.
 */
export function htmlToMarkdown(raw?: string): string {
  if (!raw) return "";
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!/<[a-z!/][^>]*>/i.test(normalized)) {
    return normalized.trimEnd();
  }
  if (typeof DOMParser === "undefined") {
    return normalized.replace(/<[^>]+>/g, " ").trim();
  }

  const doc = new DOMParser().parseFromString(normalized, "text/html");
  const out = Array.from(doc.body.childNodes)
    .map((node) => serializeHtmlNode(node, 0))
    .join("");

  return out.replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * Normalizes HTML or Markdown input and returns XSS-safe formatted HTML for display.
 */
export function renderMarkdownSafeHtml(raw?: string): string {
  const md = htmlToMarkdown(raw);
  if (!md.trim()) return "";
  return markdownToHtml(md);
}
