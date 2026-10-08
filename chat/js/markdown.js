// Minimal, safe Markdown → HTML renderer for chat messages.
//
// Every piece of text (user input and model output alike) is HTML-escaped
// before any markup is added, so the result can be inserted with innerHTML
// without opening a script-injection hole. Links are limited to http(s) and
// mailto. It handles what chat replies commonly use: fenced code, inline code,
// headings, bold/italic/strikethrough, lists, block quotes, rules, links.
// It is intentionally small; it does not aim for full CommonMark.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

const FENCE_OPEN = /^\s{0,3}```\s*([\w+#.-]*)\s*$/;
const FENCE_CLOSE = /^\s{0,3}```\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>/;
const UL_ITEM = /^\s*[-*+]\s+(.*)$/;
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/;

function isBlockStart(line) {
  return FENCE_OPEN.test(line) || HEADING.test(line) || RULE.test(line) ||
    QUOTE.test(line) || UL_ITEM.test(line) || OL_ITEM.test(line);
}

// Inline formatting. Code spans and links are pulled out into placeholders
// first, so emphasis rules cannot touch their contents.
function renderInline(text) {
  const held = [];
  const hold = (html) => {
    held.push(html);
    return `\u0000${held.length - 1}\u0000`;
  };

  let s = escapeHtml(String(text).replace(/\u0000/g, ''));

  s = s.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${code}</code>`));

  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
    // `url` is already escaped; it cannot contain quotes or spaces here.
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return match;
    return hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  });

  s = s.replace(/https?:\/\/[^\s<]+/g, (match) => {
    const trailing = (match.match(/[.,;:!?)\]]+$/) || [''])[0];
    const url = match.slice(0, match.length - trailing.length);
    return hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`) + trailing;
  });

  s = s.replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`);
  s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
  s = s.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');

  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => held[Number(n)]);
}

function codeBlock(lang, code) {
  const label = lang ? escapeHtml(lang) : 'code';
  return (
    `<div class="code-block">` +
      `<div class="code-head"><span>${label}</span>` +
      `<button type="button" class="copy-btn" data-action="copy-code">Copy</button></div>` +
      `<pre><code>${escapeHtml(code)}</code></pre>` +
    `</div>`
  );
}

function renderBlocks(lines) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(FENCE_OPEN);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i])) body.push(lines[i++]);
      i++; // skip the closing fence; an unclosed fence runs to the end (streaming)
      out.push(codeBlock(fence[1], body.join('\n')));
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      }
      out.push(`<blockquote>${renderBlocks(quoted)}</blockquote>`);
      continue;
    }

    if (UL_ITEM.test(line) || OL_ITEM.test(line)) {
      const tag = OL_ITEM.test(line) ? 'ol' : 'ul';
      const item = tag === 'ol' ? OL_ITEM : UL_ITEM;
      const items = [];
      while (i < lines.length && item.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].match(item)[1])}</li>`);
        i++;
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(lines[i++]);
    }
    if (!para.length) para.push(lines[i++]); // always make progress
    out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
  }

  return out.join('');
}

export function renderMarkdown(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  return renderBlocks(text.split('\n'));
}
