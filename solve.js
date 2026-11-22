// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
// Byte-identical output, built for speed: fused single-pass Markdown rendering
// (no token arrays), hand-rolled scanners instead of regexes in hot loops,
// cached slugify, chunked HTML escaping, and templates compiled to JS
// functions (codegen) instead of a tree-walking renderer. Every rule mirrors
// the reference code (vendor/makefun-site) exactly; the README is not trusted
// where it differs from the code.

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- text

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** `text` with & < > " and ' escaped (regex replace; the test skips clean text). */
export function escapeHtml(text) {
  if (!/[&<>"']/.test(text)) return text;
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export const SLUG_MAX = 64;

// Slug cache, cleared at the start of every build() so nothing is carried
// from one case to the next. Titles and tag names repeat heavily in a case.
let slugCache = new Map();

function slugifyRaw(text) {
  let plain = text;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) >= 128) { ascii = false; break; }
  }
  if (!ascii) plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  if (ascii) {
    for (let i = 0; i < plain.length; i++) {
      const code = plain.charCodeAt(i);
      let keep = null;
      if (code >= 65 && code <= 90) keep = String.fromCharCode(code + 32);
      else if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) keep = plain[i];
      if (keep === null) { gap = out.length > 0; continue; }
      if (gap) out += '-';
      gap = false;
      out += keep;
    }
  } else {
    for (const ch of plain) {
      let keep = null;
      if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
      else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
      if (keep === null) { gap = out.length > 0; continue; }
      if (gap) out += '-';
      gap = false;
      out += keep;
    }
  }
  out = out.slice(0, SLUG_MAX);
  let end = out.length;
  while (end > 0 && out.charCodeAt(end - 1) === 45) end--;
  if (end !== out.length) out = out.slice(0, end);
  return out === '' ? 'untitled' : out;
}

export function slugify(text) {
  let v = slugCache.get(text);
  if (v === undefined) { v = slugifyRaw(text); slugCache.set(text, v); }
  return v;
}

export function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function longDate(date) {
  const [y, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

// ---------------------------------------------------------------- front matter

export const KEYS = Object.freeze(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME = /^[a-z0-9-]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.startsWith('[')) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Parse one front-matter line: [key, raw] or null when it is not "key: value". */
function fmLine(line) {
  let k = 0;
  while (k < line.length) {
    const c = line.charCodeAt(k);
    if ((c >= 97 && c <= 122) || c === 95) k++;
    else break;
  }
  if (k === 0 || k >= line.length || line.charCodeAt(k) !== 58) return null;
  const rest = line.slice(k + 1);
  if (rest === '') return [line.slice(0, k), ''];
  if (rest.charCodeAt(0) !== 32) return null;
  return [line.slice(0, k), rest.slice(1)];
}

export function parseFrontMatter(text) {
  let nl = text.indexOf('\n');
  const first = nl === -1 ? text : text.slice(0, nl);
  if (first !== '---') return { error: 'no front matter' };
  // Find the closing line first: the reference refuses an unclosed front
  // matter before it reports any line inside it.
  let pos = nl === -1 ? text.length : nl + 1;
  const fmLines = [];
  let closeEnd = -1;
  for (;;) {
    const e = text.indexOf('\n', pos);
    const line = e === -1 ? text.slice(pos) : text.slice(pos, e);
    if (line === '---') { closeEnd = e; break; }
    fmLines.push(line);
    if (e === -1) return { error: 'the front matter is not closed' };
    pos = e + 1;
  }
  const data = {};
  for (let idx = 0; idx < fmLines.length; idx++) {
    const line = fmLines[idx];
    if (!isBlankLine(line) && !line.startsWith('#')) {
      const m = fmLine(line);
      if (m === null) return { error: `line ${idx + 2} is not "key: value"` };
      const key = m[0];
      let raw = m[1];
      let r = raw.length;
      while (r > 0) {
        const c = raw.charCodeAt(r - 1);
        if (c === 32 || c === 9) r--;
        else break;
      }
      if (r !== raw.length) raw = raw.slice(0, r);
      if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = valueOf(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: closeEnd === -1 ? '' : text.slice(closeEnd + 1) };
}

// ---------------------------------------------------------------- markdown (fused lex + render)

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

/** The first index in [from, end) where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from, end) {
  const last = end - what.length;
  for (let j = from; j <= last; j++) {
    if (s[j] === '\\' && j + 1 < end && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * in [from, end) (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from, end) {
  for (let j = from; j < end; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < end && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (j + 1 < end && s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

const ESC_RE = /[&<>"']/g;

/** s[a..b) with & < > " ' escaped; the whole string itself when the range is all of it and clean. */
function escapeRange(s, a, b) {
  ESC_RE.lastIndex = a;
  let m = ESC_RE.exec(s);
  if (m === null || m.index >= b) return a === 0 && b === s.length ? s : s.slice(a, b);
  let out = s.slice(a, m.index) + ESCAPES[m[0]];
  let start = m.index + 1;
  while ((m = ESC_RE.exec(s)) !== null && m.index < b) {
    out += s.slice(start, m.index) + ESCAPES[m[0]];
    start = m.index + 1;
  }
  if (start < b) out += s.slice(start, b);
  return out;
}

const SPECIAL_RE = /[\\`*\[&<>"']/g;

/**
 * s[i..end) rendered inline; `env.link(target)` is a link's href. Works on index
 * ranges of the one string — nested constructs recurse on ranges, never on
 * substring copies — with the reference's semantics exactly (a backslash escape
 * writes its character ESCAPED, so \> is "&gt;", not ">"). One regex scan finds
 * the next character needing any work (a Markdown special or an HTML special);
 * the plain run before it needs no escaping by construction and is copied raw.
 * SPECIAL_RE's lastIndex is set before every exec, and no scan is ever in
 * flight across a recursive call, so sharing the regex is safe.
 */
function inlineRange(s, i, end, env) {
  let out = '';
  while (i < end) {
    SPECIAL_RE.lastIndex = i;
    const sm = SPECIAL_RE.exec(s);
    const n = sm === null || sm.index >= end ? end : sm.index;
    if (n > i) { out += s.slice(i, n); i = n; }
    if (i >= end) break;
    const c = s[i];
    if (c === '&') { out += '&amp;'; i++; continue; }
    if (c === '<') { out += '&lt;'; i++; continue; }
    if (c === '>') { out += '&gt;'; i++; continue; }
    if (c === '"') { out += '&quot;'; i++; continue; }
    if (c === "'") { out += '&#39;'; i++; continue; }
    if (c === '\\') {
      if (i + 1 < end && ESCAPABLE.has(s[i + 1])) {
        const e = s[i + 1];
        out += e === '>' ? '&gt;' : e;
        i += 2;
      } else { out += '\\'; i++; }
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j !== -1 && j < end && j > i + 1) {
        out += `<code>${escapeRange(s, i + 1, j)}</code>`;
        i = j + 1;
      } else { out += '`'; i++; }
      continue;
    }
    if (c === '*') {
      if (i + 1 < end && s[i + 1] === '*') {
        const j = findUnescaped(s, '**', i + 2, end);
        if (j > i + 2) { out += `<strong>${inlineRange(s, i + 2, j, env)}</strong>`; i = j + 2; }
        else { out += '**'; i += 2; }
        continue;
      }
      const j = findSingleStar(s, i + 1, end);
      if (j > i + 1) { out += `<em>${inlineRange(s, i + 1, j, env)}</em>`; i = j + 1; }
      else { out += '*'; i++; }
      continue;
    }
    // c === '['
    const kk = findUnescaped(s, ']', i + 1, end);
    let m = -1;
    if (kk !== -1 && kk + 1 < end && s[kk + 1] === '(') {
      m = s.indexOf(')', kk + 2);
      if (m === -1 || m >= end) m = -1;
    }
    const target = m === -1 ? '' : s.slice(kk + 2, m);
    if (target !== '' && !/\s/.test(target)) {
      out += `<a href="${escapeHtml(env.link(target))}">${inlineRange(s, i + 1, kk, env)}</a>`;
      i = m + 1;
    } else {
      out += '[';
      i++;
    }
  }
  return out;
}

/** `s` rendered inline; `env.link(target)` is a link's href. */
export function inline(s, env) {
  return inlineRange(s, 0, s.length, env);
}

const trimLine = (line) => {
  let a = 0;
  let b = line.length;
  while (a < b) {
    const c = line.charCodeAt(a);
    if (c !== 32 && c !== 9) break;
    a++;
  }
  while (b > a) {
    const c = line.charCodeAt(b - 1);
    if (c !== 32 && c !== 9) break;
    b--;
  }
  return a === 0 && b === line.length ? line : line.slice(a, b);
};
const CONTINUED = /^ {2,}\S/;

function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Fence-open match: [lang] or null. */
function fenceOpen(line) {
  if (!line.startsWith('```')) return null;
  let i = 3;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  for (let j = i; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return null;
  }
  return line.slice(3, i);
}

function isFenceClose(line) {
  if (!line.startsWith('```')) return false;
  for (let j = 3; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Heading match: [depth, text] or null. */
function headingOf(line) {
  let d = 0;
  while (d < line.length && line.charCodeAt(d) === 35) d++;
  if (d === 0 || d > 6) return null;
  if (d >= line.length) return null;
  let s = d;
  while (s < line.length) {
    const c = line.charCodeAt(s);
    if (c !== 32 && c !== 9) break;
    s++;
  }
  if (s === d) return null; // no space/tab after the #'s: not a heading
  if (s >= line.length) return null;
  let end = line.length;
  while (end > s && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end--;
  const text = line.slice(s, end);
  if (text === '') return null;
  return [d, text];
}

function isHr(line) {
  if (line !== '---' && line !== '***') {
    if (!line.startsWith('---') && !line.startsWith('***')) return false;
    const head = line.slice(0, 3);
    if (head !== '---' && head !== '***') return false;
    for (let j = 3; j < line.length; j++) {
      const c = line.charCodeAt(j);
      if (c !== 32 && c !== 9) return false;
    }
    return true;
  }
  return true;
}

function endsParagraph(line) {
  return isBlank(line) || fenceOpen(line) !== null || headingOf(line) !== null || isHr(line);
}

export function renderMarkdown(src, env) {
  const lines = src.split('\n');
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  const len = lines.length;
  while (i < len) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const fenceLang = fenceOpen(line);
    if (fenceLang !== null) {
      i++;
      let code = '';
      while (i < len && !isFenceClose(lines[i])) { code += `${escapeHtml(lines[i])}\n`; i++; }
      i++;
      const cls = fenceLang === '' ? '' : ` class="language-${escapeHtml(fenceLang)}"`;
      blocks.push(`<pre><code${cls}>${code}</code></pre>`);
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      const id = uniqueSlug(slugify(heading[1]), ids);
      const html = inline(heading[1], env);
      blocks.push(`<h${heading[0]} id="${id}">${html}</h${heading[0]}>`);
      if (heading[0] === 2 || heading[0] === 3) toc.push({ level: heading[0], id, html });
      i++;
      continue;
    }
    if (isHr(line)) { blocks.push('<hr>'); i++; continue; }
    if (line.charCodeAt(0) === 62) {
      const body = [];
      while (i < len && lines[i].charCodeAt(0) === 62) {
        let l = lines[i];
        l = l.slice(1);
        if (l.charCodeAt(0) === 32) l = l.slice(1);
        body.push(l);
        i++;
      }
      const trimmed = [];
      for (const l of body) {
        const t = trimLine(l);
        if (t !== '') trimmed.push(t);
      }
      blocks.push(trimmed.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(trimmed.join('\n'), env)}</p>\n</blockquote>`);
      continue;
    }
    const isBullet = (line.charCodeAt(0) === 45 || line.charCodeAt(0) === 42) && line.charCodeAt(1) === 32;
    let orderedNum = -1;
    if (!isBullet) {
      let d = 0;
      while (d < line.length && d < 9) {
        const c = line.charCodeAt(d);
        if (c >= 48 && c <= 57) d++;
        else break;
      }
      if (d > 0 && d < line.length && line.charCodeAt(d) === 46 && line.charCodeAt(d + 1) === 32) orderedNum = Number(line.slice(0, d));
    }
    if (isBullet || orderedNum !== -1) {
      const isOrdered = orderedNum !== -1;
      const items = [];
      while (i < len) {
        const l = lines[i];
        let rest = null;
        if (isOrdered) {
          let d = 0;
          while (d < l.length && d < 9) {
            const c = l.charCodeAt(d);
            if (c >= 48 && c <= 57) d++;
            else break;
          }
          if (d > 0 && d < l.length && l.charCodeAt(d) === 46 && l.charCodeAt(d + 1) === 32) rest = l.slice(d + 2);
        } else if ((l.charCodeAt(0) === 45 || l.charCodeAt(0) === 42) && l.charCodeAt(1) === 32) {
          rest = l.slice(2);
        }
        if (rest !== null) {
          items.push([trimLine(rest)]);
          i++;
        } else if (CONTINUED.test(l)) {
          items[items.length - 1].push(trimLine(l));
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && orderedNum !== 1 ? `<ol start="${orderedNum}">` : `<${tag}>`;
      let inner = '';
      for (const item of items) inner += `<li>${inline(item.join('\n'), env)}</li>\n`;
      blocks.push(`${open}\n${inner}</${tag}>`);
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < len && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>`);
  }
  let html = '';
  for (const b of blocks) html += `${b}\n`;
  return { html, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

export const INCLUDE_DEPTH = 8;

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

export class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

export function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

function lookup(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

const RT = { lookup, textOf, truthy, esc: escapeHtml };

/** Compile parsed template nodes to a function (R, T, scope, depth) -> string. */
function compileNodes(nodes) {
  // Every distinct lookup path of this template is hoisted into PC (one array
  // per path, built once at compile time): the generated code must not allocate
  // a fresh path array for every {{ }} / if / for it evaluates.
  const paths = [];
  const pathIds = new Map();
  const pid = (path) => {
    const k = JSON.stringify(path);
    let id = pathIds.get(k);
    if (id === undefined) { id = paths.length; paths.push(path); pathIds.set(k, id); }
    return id;
  };
  let tmp = 0;
  const gen = (ns, out) => {
    for (const n of ns) {
      switch (n.kind) {
        case 'text':
          out.push(`out+=${JSON.stringify(n.text)};`);
          break;
        case 'var':
          out.push(`out+=ES(TO(LU(scope,PC[${pid(n.path)}])));`);
          break;
        case 'raw':
          out.push(`out+=TO(LU(scope,PC[${pid(n.path)}]));`);
          break;
        case 'if': {
          out.push(`if(TR(LU(scope,PC[${pid(n.path)}]))!==${n.not}){`);
          gen(n.then, out);
          out.push('}');
          if (n.else !== null) {
            out.push('else{');
            gen(n.else, out);
            out.push('}');
          }
          break;
        }
        case 'for': {
          const k = tmp++;
          out.push(`{const __xs${k}=LU(scope,PC[${pid(n.path)}]);if(Array.isArray(__xs${k})){for(let __i${k}=0;__i${k}<__xs${k}.length;__i${k}++){const __p${k}=scope;scope={vars:{[${JSON.stringify(n.name)}]:__xs${k}[__i${k}],loop:{index:__i${k}+1,first:__i${k}===0,last:__i${k}===__xs${k}.length-1,length:__xs${k}.length}},parent:__p${k}};`);
          gen(n.body, out);
          out.push(`scope=__p${k};}}}`);
          break;
        }
        case 'include': {
          const k = tmp++;
          out.push(`if(depth<8){const __t${k}=T.get(${JSON.stringify(n.name)});if(__t${k}!==undefined)out+=__t${k}(R,T,scope,depth+1);}`);
          break;
        }
      }
    }
  };
  const parts = ['const LU=R.lookup,TO=R.textOf,TR=R.truthy,ES=R.esc;let out="";'];
  gen(nodes, parts);
  parts.push('return out;');
  const factory = new Function('PC', `return function(R,T,scope,depth){${parts.join('')}}`);
  return factory(paths);
}

// ---------------------------------------------------------------- build

export const REPORT_FILE = 'build-report.txt';
export const RESERVED = Object.freeze(['posts', 'tags', 'page']);

/** The words of a body: runs of non-whitespace (JS \S), counted without allocating a match array. */
function wordsOf(text) {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let ws;
    if (c < 128) ws = c === 32 || (c >= 9 && c <= 13);
    else ws = c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279;
    if (ws) inWord = false;
    else if (!inWord) { inWord = true; count++; }
  }
  return count;
}

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

export function build(input) {
  slugCache = new Map();
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, compileNodes(parseTemplate(name, input.templates[name])));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const b = {
    input,
    base: input.site.base_url.replace(/\/+$/, ''),
    templates,
    sources: [],
    statics: [],
    bySource: new Map(),
    broken: new Set(),
    report,
    posts: [],
    tags: [],
    cards: new Map(),
    output: {},
  };

  // 1. sources, sorted by path; .md sources have \r\n? made \n
  {
    const files = [...b.input.files].sort((x, y) => byCodeUnits(x.path, y.path));
    for (const f of files) {
      if (f.path.endsWith('.md')) b.sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
      else b.statics.push({ path: f.path, content: f.content });
    }
  }

  // 2. front matter, in check order: parse, own dir, post date, layout, draft
  {
    const kept = [];
    for (const s of b.sources) {
      const fm = parseFrontMatter(s.text);
      if ('error' in fm) { b.report.push(`refused ${s.path}: ${fm.error}`); continue; }
      s.data = fm.data;
      s.body = fm.body;
      s.post = s.path.startsWith('posts/');
      const own = s.path.startsWith('tags/') ? 'tags' : s.path.startsWith('page/') ? 'page' : undefined;
      if (own !== undefined) { b.report.push(`refused ${s.path}: ${own}/ is the generator's own`); continue; }
      if (s.post && !Object.hasOwn(s.data, 'date')) { b.report.push(`refused ${s.path}: a post needs a date`); continue; }
      const layout = s.data.layout ?? (s.post ? 'post' : 'page');
      if (!b.templates.has(layout)) { b.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`); continue; }
      s.layout = layout;
      if (s.data.draft === true) { b.report.push(`draft ${s.path}`); continue; }
      kept.push(s);
    }
    b.sources = kept;
  }

  // 3. permalinks
  {
    const taken = new Map();
    const takenIn = (dir) => {
      if (!taken.has(dir)) taken.set(dir, new Set(dir === '' ? RESERVED : []));
      return taken.get(dir);
    };
    for (const s of b.sources) {
      const dir = s.post ? 'posts' : dirOf(s.path);
      const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), takenIn(dir));
      s.slug = slug;
      s.outDir = dir === '' ? slug : `${dir}/${slug}`;
      s.url = `${b.base}/${s.outDir}/`;
      b.bySource.set(s.path, s);
    }
  }

  // 4. markdown + link resolution
  {
    const staticPaths = new Set(b.statics.map((f) => f.path));
    // Link resolutions repeat across sources in one build; bySource and the
    // static set are fixed for the whole phase, so a resolved href is cached
    // per (directory, target). A broken target caches as null: its report line
    // names the linking source, so it is re-added for each source. (A target
    // never holds whitespace, so the last newline of the key is the split.)
    const linkCache = new Map();
    for (const s of b.sources) {
      const dir = dirOf(s.path);
      const env = {
        link: (target) => {
          const key = `${dir}\n${target}`;
          const hit = linkCache.get(key);
          if (hit !== undefined) {
            if (hit === null) { b.broken.add(`broken-link ${s.path} -> ${target}`); return target; }
            return hit;
          }
          if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) {
            linkCache.set(key, target);
            return target;
          }
          const hash = target.indexOf('#');
          const rel = hash === -1 ? target : target.slice(0, hash);
          const frag = hash === -1 ? '' : target.slice(hash);
          const path = rel === '' ? null : resolvePath(dir, rel);
          if (path !== null && b.bySource.has(path)) {
            const out = `${b.bySource.get(path).url}${frag}`;
            linkCache.set(key, out);
            return out;
          }
          if (path !== null && staticPaths.has(path)) {
            const out = `${b.base}/${path}${frag}`;
            linkCache.set(key, out);
            return out;
          }
          b.broken.add(`broken-link ${s.path} -> ${target}`);
          linkCache.set(key, null);
          return target;
        },
      };
      const md = renderMarkdown(s.body, env);
      s.html = md.html;
      s.toc = md.toc;
      s.excerpt = md.excerpt;
    }
  }

  // 5. collections
  {
    const posts = b.sources.filter((s) => s.post);
    posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
    b.posts = posts;
    posts.forEach((p, k) => {
      p.newer = k === 0 ? null : posts[k - 1];
      p.older = k === posts.length - 1 ? null : posts[k + 1];
    });
  }

  // 6. tags
  {
    const bySlug = new Map();
    const ownTags = (s) => {
      const seen = new Set();
      const out = [];
      for (const name of (s.data.tags ?? [])) {
        const sg = slugify(name);
        if (!seen.has(sg)) { seen.add(sg); out.push(name); }
      }
      return out;
    };
    for (const p of b.posts) {
      p.tagRefs = [];
      for (const name of ownTags(p)) {
        const slug = slugify(name);
        if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, url: `${b.base}/tags/${slug}/`, posts: [] });
        const tag = bySlug.get(slug);
        tag.posts.push(p);
        p.tagRefs.push(tag);
      }
    }
    for (const s of b.sources) {
      if (s.post) continue;
      s.tagRefs = ownTags(s).map((name) => {
        const sg = slugify(name);
        return bySlug.get(sg) ?? { name, slug: sg, url: '', posts: [] };
      });
    }
    b.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
  }

  // 7. layouts
  {
    const linkOf = (s) => {
      if (s === null) return null;
      if (s._link === undefined) s._link = { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) };
      return s._link;
    };
    const cardOf = (s) => {
      if (s._rm === undefined) s._rm = Math.max(1, Math.ceil(wordsOf(s.body) / 200));
      if (s._tagList === undefined) s._tagList = s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url }));
      return {
        title: s.data.title,
        url: s.url,
        date: s.data.date ?? '',
        date_long: s.data.date === undefined ? '' : longDate(s.data.date),
        summary: s.data.summary ?? '',
        excerpt: s.excerpt,
        reading_minutes: s._rm,
        tags: s._tagList,
      };
    };
    // A post's page reuses its cached card (the spread copies the same values);
    // the toc entries already hold exactly {level, id, html}, so they are
    // shared, not re-created. Templates only ever read these objects.
    const pageOf = (s) => ({
      ...(b.cards.get(s) ?? cardOf(s)),
      slug: s.slug,
      content: s.html,
      toc: s.toc,
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    });
    b.cards = new Map(b.posts.map((p) => [p, cardOf(p)]));
    const site = { title: b.input.site.title, base_url: b.base };
    const allTags = b.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
    const recent = b.posts.slice(0, b.input.site.recent).map((p) => b.cards.get(p));
    const render = (name, vars) => {
      const fn = b.templates.get(name);
      return fn === undefined ? null : fn(RT, b.templates, { vars: { site, tags: allTags, recent, ...vars }, parent: null }, 0);
    };
    for (const s of b.sources) b.output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
    const per = b.input.site.per_page;
    const pages = Math.max(1, Math.ceil(b.posts.length / per));
    const indexUrl = (k) => (k === 1 ? `${b.base}/` : `${b.base}/page/${k}/`);
    for (let k = 1; k <= pages; k++) {
      const html = render('index', {
        posts: b.posts.slice((k - 1) * per, k * per).map((p) => b.cards.get(p)),
        pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
      });
      if (html !== null) b.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
    }
    for (const t of b.tags) {
      const tagObj = { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => b.cards.get(p)) };
      const html = render('tag', { tag: tagObj });
      if (html !== null) b.output[`tags/${t.slug}/index.html`] = html;
    }
    const tagsHtml = render('tags', {});
    if (tagsHtml !== null) b.output['tags/index.html'] = tagsHtml;
    for (const f of b.statics) {
      if (Object.hasOwn(b.output, f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`);
      else b.output[f.path] = f.content;
    }
  }

  // 8. report
  {
    const lines = [...b.report, ...b.broken].sort(byCodeUnits);
    const pages = b.sources.filter((s) => !s.post).length;
    lines.push(`built ${pages} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`);
    b.output[REPORT_FILE] = `${lines.join('\n')}\n`;
  }

  return b.output;
}

/** makefun-site 1.0.0's answer for one case's input. */
export function run(input) {
  return build(input);
}
