(() => {
if (globalThis.__aiPageSummarizerContentLoaded) return;
globalThis.__aiPageSummarizerContentLoaded = true;

const HIGHLIGHT_CLASS = "ai-page-summarizer-highlight";
const HIGHLIGHT_STYLE_ID = "ai-page-summarizer-style";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "EXTRACT_PAGE") {
    sendResponse({ ok: true, page: extractReadablePage() });
    return false;
  }

  if (message.type === "HIGHLIGHT_KEY_POINTS") {
    const count = highlightKeyPoints(message.phrases);
    sendResponse({ ok: true, count });
    return false;
  }

  if (message.type === "CLEAR_HIGHLIGHTS") {
    clearHighlights();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

function extractReadablePage() {
  const title = getTitle();
  const source = selectReadableRoot();
  const cleaned = cleanClone(source);
  const textParts = collectTextBlocks(cleaned);
  const text = textParts.join("\n\n").replace(/[ \t]+\n/g, "\n").trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    title,
    url: location.href,
    text,
    wordCount,
    readingTimeMinutes: Math.max(1, Math.ceil(wordCount / 225))
  };
}

function getTitle() {
  const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
  return (ogTitle || document.title || location.hostname).trim();
}

function selectReadableRoot() {
  const candidates = [
    ...document.querySelectorAll(
      "article, main, [role='main'], .article, .post, .entry-content, .post-content, .story-body"
    )
  ];

  const scored = candidates
    .map((element) => ({ element, score: scoreElement(element) }))
    .filter((item) => item.score > 400)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.element || document.body;
}

function scoreElement(element) {
  const text = (element.innerText || "").replace(/\s+/g, " ").trim();
  const paragraphCount = element.querySelectorAll("p").length;
  const linkTextLength = [...element.querySelectorAll("a")]
    .map((link) => link.innerText || "")
    .join(" ").length;
  const linkPenalty = text.length ? linkTextLength / text.length : 1;
  const semanticBonus = /^(ARTICLE|MAIN)$/.test(element.tagName) ? 600 : 0;
  return text.length + paragraphCount * 120 + semanticBonus - linkPenalty * 900;
}

function cleanClone(root) {
  const clone = root.cloneNode(true);
  clone
    .querySelectorAll(
      [
        "script",
        "style",
        "noscript",
        "template",
        "svg",
        "canvas",
        "iframe",
        "form",
        "input",
        "button",
        "nav",
        "aside",
        "footer",
        "header",
        "[role='navigation']",
        "[role='banner']",
        "[role='contentinfo']",
        "[aria-hidden='true']",
        ".nav",
        ".navbar",
        ".menu",
        ".sidebar",
        ".footer",
        ".header",
        ".comments",
        ".comment",
        ".related",
        ".share",
        ".social",
        ".newsletter",
        ".advertisement",
        ".ad",
        "[class*='cookie']",
        "[id*='cookie']",
        "[class*='promo']",
        "[class*='subscribe']"
      ].join(",")
    )
    .forEach((node) => node.remove());

  return clone;
}

function collectTextBlocks(root) {
  const selectors = "h1, h2, h3, p, li, blockquote";
  const blocks = [...root.querySelectorAll(selectors)]
    .map((node) => normalizeBlock(node.innerText || node.textContent || ""))
    .filter(isMeaningfulBlock);

  if (blocks.join(" ").length > 500) {
    return dedupeBlocks(blocks).slice(0, 180);
  }

  return dedupeBlocks(
    (root.innerText || root.textContent || "")
      .split(/\n{2,}/)
      .map(normalizeBlock)
      .filter(isMeaningfulBlock)
  ).slice(0, 180);
}

function normalizeBlock(text) {
  return text.replace(/\s+/g, " ").trim();
}

function isMeaningfulBlock(text) {
  if (!text || text.length < 45) return false;
  if (text.length > 5000) return false;
  const words = text.split(/\s+/).length;
  if (words < 7) return false;
  const clutterPattern = /^(sign up|subscribe|advertisement|cookie|privacy|terms|share|follow us)\b/i;
  return !clutterPattern.test(text);
}

function dedupeBlocks(blocks) {
  const seen = new Set();
  return blocks.filter((block) => {
    const key = block.toLowerCase().slice(0, 160);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function highlightKeyPoints(phrases = []) {
  clearHighlights();
  const safePhrases = phrases
    .map((phrase) => String(phrase || "").trim())
    .filter((phrase) => phrase.length >= 4 && phrase.length <= 80)
    .slice(0, 8);

  if (!safePhrases.length) return 0;
  ensureHighlightStyle();

  const matcher = new RegExp(
    safePhrases.map(escapeRegExp).join("|"),
    "gi"
  );
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || !matcher.test(node.nodeValue)) {
          matcher.lastIndex = 0;
          return NodeFilter.FILTER_REJECT;
        }
        matcher.lastIndex = 0;
        const parent = node.parentElement;
        if (!parent || parent.closest("script, style, textarea, input, mark")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const nodes = [];
  while (nodes.length < 80) {
    const next = walker.nextNode();
    if (!next) break;
    nodes.push(next);
  }

  nodes.forEach((node) => wrapMatches(node, matcher));
  return document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).length;
}

function wrapMatches(textNode, matcher) {
  const text = textNode.nodeValue;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  matcher.lastIndex = 0;

  text.replace(matcher, (match, offset) => {
    if (offset > lastIndex) {
      fragment.append(document.createTextNode(text.slice(lastIndex, offset)));
    }
    const mark = document.createElement("mark");
    mark.className = HIGHLIGHT_CLASS;
    mark.textContent = match;
    fragment.append(mark);
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < text.length) {
    fragment.append(document.createTextNode(text.slice(lastIndex)));
  }
  textNode.replaceWith(fragment);
}

function clearHighlights() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent || ""));
  });
  document.body.normalize();
}

function ensureHighlightStyle() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background: #ffe66d;
      color: #1f2937;
      box-decoration-break: clone;
      border-radius: 0.18em;
      padding: 0.04em 0.16em;
    }
  `;
  document.documentElement.append(style);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
})();
