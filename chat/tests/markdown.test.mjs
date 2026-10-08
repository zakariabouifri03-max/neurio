// Run with: npm test (from chat/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, escapeHtml } from '../js/markdown.js';

test('escapes raw HTML so model output cannot inject markup', () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)"> & <script>alert(2)</script>');
  assert.ok(!html.includes('<img'), html);
  assert.ok(!html.includes('<script'), html);
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&amp;'));
});

test('escapeHtml covers the five special characters', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('paragraphs and soft line breaks', () => {
  assert.equal(renderMarkdown('hello\nworld\n\nsecond'), '<p>hello<br>world</p><p>second</p>');
});

test('headings', () => {
  assert.equal(renderMarkdown('# Title'), '<h1>Title</h1>');
  assert.equal(renderMarkdown('### Small ###'), '<h3>Small</h3>');
  // "#" without a following space is not a heading
  assert.equal(renderMarkdown('#hashtag'), '<p>#hashtag</p>');
});

test('bold, italic, strikethrough, inline code', () => {
  assert.equal(renderMarkdown('**bold** and *em* and ~~gone~~'),
    '<p><strong>bold</strong> and <em>em</em> and <del>gone</del></p>');
  assert.equal(renderMarkdown('use `a*b*c` here'), '<p>use <code>a*b*c</code> here</p>');
  assert.equal(renderMarkdown('snake_case_name stays'), '<p>snake_case_name stays</p>');
});

test('lists, unordered and ordered', () => {
  assert.equal(renderMarkdown('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(renderMarkdown('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
});

test('fenced code keeps its content literal and escaped', () => {
  const html = renderMarkdown('```js\nif (a < b && **x**) {}\n```');
  assert.match(html, /<span>js<\/span>/);
  assert.match(html, /<code>if \(a &lt; b &amp;&amp; \*\*x\*\*\) \{\}<\/code>/);
  assert.match(html, /data-action="copy-code"/);
});

test('unclosed fence (mid-stream) renders as code to the end', () => {
  const html = renderMarkdown('before\n```py\nprint(1)');
  assert.match(html, /<p>before<\/p>/);
  assert.match(html, /<code>print\(1\)<\/code>/);
});

test('links: only http(s) and mailto become anchors', () => {
  assert.match(renderMarkdown('[docs](https://developer.puter.com)'),
    /<a href="https:\/\/developer\.puter\.com" target="_blank" rel="noopener noreferrer">docs<\/a>/);
  const bad = renderMarkdown('[click](javascript:alert(1))');
  assert.ok(!bad.includes('<a '), bad);
  assert.ok(!bad.includes('javascript:alert(1))</a>'));
});

test('bare URLs are linked without swallowing trailing punctuation', () => {
  const html = renderMarkdown('See https://example.com/a?b=1.');
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1" /);
  assert.match(html, /<\/a>\.<\/p>$/);
});

test('blockquote and horizontal rule', () => {
  assert.equal(renderMarkdown('> quoted'), '<blockquote><p>quoted</p></blockquote>');
  assert.equal(renderMarkdown('---'), '<hr>');
});

test('empty and nullish input', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(undefined), '');
  assert.equal(renderMarkdown(null), '');
});

test('NUL characters cannot forge placeholders', () => {
  const html = renderMarkdown('x\u00000\u0000y `code`');
  assert.ok(!html.includes('\u0000'));
  assert.match(html, /<code>code<\/code>/);
});
