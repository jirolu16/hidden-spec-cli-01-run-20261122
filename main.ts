// main.ts is mend, the CLI SPEC.md specifies, built from the kit's starting point for it (MIT). The starter did
// sections 1 to 4, 9 and 10 of SPEC.md: the command line, the output and exit codes, safe paths, format detection,
// JSON edits and the all-or-nothing write. Added on top of it, in this file: matching lines at three tiers
// (section 5), unified diffs (section 6), SEARCH/REPLACE blocks (section 7), V4A patches (section 8), and the
// R lines for successful moves in the output. Node 22, the standard library alone; run it as
// `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  /** Move edits that succeeded, as [old path, new path], for the `R` lines of section 2. */
  readonly moves: Array<readonly [string, string]> = [];
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

/** A file as lines (section 3): its own line break, its lines, and whether it ends with a break. */
interface FileLines {
  lines: string[];
  br: string;
  final: boolean;
}

function splitText(text: string): FileLines {
  if (text === '') return { lines: [], br: '\n', final: false };
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const final = text.endsWith(br);
  const lines = text.split(br);
  if (final) lines.pop();
  return { lines, br, final };
}

function joinText(fl: FileLines): string {
  if (fl.lines.length === 0) return '';
  return fl.lines.join(fl.br) + (fl.final ? fl.br : '');
}

/** One line of a hunk, chunk or block body, in body order; `marker` is a `\` line that followed it. */
interface BodyLine {
  kind: 'ctx' | 'old' | 'new';
  text: string;
  marker: boolean;
  /** In a unified body, the line was completely empty (a context line whose text is empty). */
  rawEmpty?: boolean;
}

const stripTrail = (s: string): string => s.replace(/[ \t]+$/, '');
const stripBoth = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const leadWs = (s: string): string => /^[ \t]*/.exec(s)![0];

/**
 * Section 5: the first tier at which `o` occurs in `lines` at or after `from`, and every position
 * there. With `endAt` set, only occurrences ending exactly at that line count. Null when no tier has one.
 */
function findTier(lines: string[], o: string[], strict: boolean, from = 0, endAt: number | null = null): { tier: number; at: number[] } | null {
  for (const tier of strict ? [0] : [0, 1, 2]) {
    const norm = tier === 0 ? (s: string): string => s : tier === 1 ? stripTrail : stripBoth;
    const want = o.map(norm);
    const at: number[] = [];
    for (let i = from; i + o.length <= lines.length; i += 1) {
      if (endAt !== null && i + o.length !== endAt) continue;
      let ok = true;
      for (let j = 0; j < o.length; j += 1) {
        if (norm(lines[i + j]!) !== want[j]) {
          ok = false;
          break;
        }
      }
      if (ok) at.push(i);
    }
    if (at.length > 0) return { tier, at };
  }
  return null;
}

/**
 * The lines a matched body writes at `pos` (section 5): context lines are the file's own matched
 * lines; at tier 2 the other lines are re-indented from O's first line's lead to the file's.
 */
function buildNew(entries: BodyLine[], fileLines: string[], pos: number, o: string[], tier: number): string[] {
  const f = tier === 2 ? leadWs(fileLines[pos]!) : '';
  const p = tier === 2 ? leadWs(o[0]!) : '';
  const out: string[] = [];
  let oi = 0;
  for (const e of entries) {
    if (e.kind === 'ctx') {
      out.push(fileLines[pos + oi]!);
      oi += 1;
    } else if (e.kind === 'old') {
      oi += 1;
    } else if (tier === 2 && e.text.trim() !== '' && e.text.startsWith(p)) {
      out.push(f + e.text.slice(p.length));
    } else {
      out.push(e.text);
    }
  }
  return out;
}

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

interface UHunk {
  a: number;
  entries: BodyLine[];
  /** A `\` line follows the hunk's last context or `+` line. */
  noEol: boolean;
}

interface USection {
  gitOld: string | undefined;
  gitNew: string | undefined;
  pair: boolean;
  pairOld: string | null;
  pairNew: string | null;
  renameFrom: string | undefined;
  renameTo: string | undefined;
  create: boolean;
  del: boolean;
  hunks: UHunk[];
}

/** A `---`/`+++` path (section 6): up to the first tab, spaces removed, `/dev/null` is no file, `a/`/`b/` removed. */
function headerPath(raw: string): string | null {
  let s = raw;
  const tab = s.indexOf('\t');
  if (tab >= 0) s = s.slice(0, tab);
  s = s.replace(/^ +/, '').replace(/ +$/, '');
  if (s === '/dev/null') return null;
  if (s.startsWith('a/') || s.startsWith('b/')) s = s.slice(2);
  return s;
}

/** Apply one section's hunks in order to a file's text (section 6); `path` names hunk failures. */
function applyHunks(text: string, hunks: UHunk[], strict: boolean, path: string): string {
  const fl = splitText(text);
  let d = 0;
  for (const h of hunks) {
    const o = h.entries.filter((e) => e.kind !== 'new').map((e) => e.text);
    if (o.length === 0) {
      const add = h.entries.filter((e) => e.kind === 'new').map((e) => e.text);
      const pos = Math.min(h.a + d, fl.lines.length);
      const atEnd = pos === fl.lines.length;
      fl.lines.splice(pos, 0, ...add);
      if (atEnd) fl.final = !h.noEol;
      d += add.length;
      continue;
    }
    const found = findTier(fl.lines, o, strict);
    if (found === null) throw new Fail('no-match', path);
    const target = h.a - 1 + d;
    let pos = found.at[0]!;
    for (const p of found.at) {
      if (Math.abs(p - target) < Math.abs(pos - target)) pos = p;
    }
    const built = buildNew(h.entries, fl.lines, pos, o, found.tier);
    const runsToEnd = pos + o.length === fl.lines.length;
    fl.lines.splice(pos, o.length, ...built);
    if (runsToEnd) fl.final = !h.noEol;
    d += built.length - o.length;
  }
  return joinText(fl);
}

/** One unified section as an edit (section 6): a creation, a deletion, a move or a change. */
function unifiedApply(sec: USection, oldP: string | null | undefined, newP: string | null | undefined, strict: boolean): Edit {
  return (tree) => {
    if (oldP != null && !safe(oldP)) throw new Fail('unsafe', oldP);
    if (newP != null && !safe(newP)) throw new Fail('unsafe', newP);
    if (oldP === null || sec.create) {
      const target = (newP ?? oldP)!;
      if (tree.get(target) !== null) throw new Fail('exists', target);
      const texts: string[] = [];
      let lastMarker = false;
      for (const h of sec.hunks) {
        for (const e of h.entries) {
          if (e.kind === 'new') {
            texts.push(e.text);
            lastMarker = e.marker;
          }
        }
      }
      tree.now.set(target, texts.length === 0 ? '' : texts.join('\n') + (lastMarker ? '' : '\n'));
      return;
    }
    if (newP === null || sec.del) {
      if (tree.get(oldP!) === null) throw new Fail('missing', oldP!);
      tree.now.set(oldP!, null);
      return;
    }
    if (oldP !== newP) {
      const before = tree.get(oldP!);
      if (before === null) throw new Fail('missing', oldP!);
      if (tree.get(newP!) !== null) throw new Fail('exists', newP!);
      tree.now.set(newP!, applyHunks(before, sec.hunks, strict, oldP!));
      tree.now.set(oldP!, null);
      tree.moves.push([oldP!, newP!]);
      return;
    }
    const p = oldP!;
    const before = tree.get(p);
    if (before === null) throw new Fail('missing', p);
    tree.now.set(p, applyHunks(before, sec.hunks, strict, p));
  };
}

/** Read a unified diff (section 6): sections, their headers and their hunks; prose outside bodies is ignored. */
function unifiedEdits(lines: string[], strict: boolean): Edit[] {
  const secs: USection[] = [];
  let cur: USection | null = null;
  const newSec = (): USection => {
    const s: USection = { gitOld: undefined, gitNew: undefined, pair: false, pairOld: null, pairNew: null, renameFrom: undefined, renameTo: undefined, create: false, del: false, hunks: [] };
    secs.push(s);
    cur = s;
    return s;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      const rest = line.slice('diff --git '.length);
      const sep = rest.startsWith('a/') ? rest.indexOf(' b/', 2) : -1;
      if (sep <= 2 || sep + 3 >= rest.length) throw new Exit2(`error: parse ${i + 1}`);
      const s = newSec();
      s.gitOld = rest.slice(2, sep);
      s.gitNew = rest.slice(sep + 3);
      i += 1;
      continue;
    }
    if (line.startsWith('--- ')) {
      const next = lines[i + 1] ?? '';
      if (next.startsWith('+++ ')) {
        const s = cur !== null && cur.hunks.length === 0 && !cur.pair ? cur : newSec();
        s.pair = true;
        s.pairOld = headerPath(line.slice(4));
        s.pairNew = headerPath(next.slice(4));
        i += 2;
        continue;
      }
      if (cur !== null && cur.hunks.length === 0) throw new Exit2(`error: parse ${i + 2}`);
      i += 1;
      continue;
    }
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m === null || cur === null) throw new Exit2(`error: parse ${i + 1}`);
      const entries: BodyLine[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j]!;
        if (l.startsWith('diff --git ')) break;
        if (l.startsWith('--- ') && (lines[j + 1] ?? '').startsWith('+++ ')) break;
        if (l === '') {
          entries.push({ kind: 'ctx', text: '', marker: false, rawEmpty: true });
          j += 1;
          continue;
        }
        const c = l[0]!;
        if (c === ' ') entries.push({ kind: 'ctx', text: l.slice(1), marker: false });
        else if (c === '-') entries.push({ kind: 'old', text: l.slice(1), marker: false });
        else if (c === '+') entries.push({ kind: 'new', text: l.slice(1), marker: false });
        else if (c === '\\') {
          const prev = entries[entries.length - 1];
          if (prev !== undefined) prev.marker = true;
          j += 1;
          continue;
        } else break;
        j += 1;
      }
      while (entries.length > 0 && entries[entries.length - 1]!.rawEmpty === true) entries.pop();
      let noEol = false;
      for (let k = entries.length - 1; k >= 0; k -= 1) {
        const e = entries[k]!;
        if (e.kind === 'ctx' || e.kind === 'new') {
          noEol = e.marker;
          break;
        }
      }
      cur.hunks.push({ a: Number(m[1]), entries, noEol });
      i = j;
      continue;
    }
    if (cur !== null && cur.hunks.length === 0) {
      if (line.startsWith('rename from ')) cur.renameFrom = line.slice('rename from '.length);
      else if (line.startsWith('rename to ')) cur.renameTo = line.slice('rename to '.length);
      else if (line.startsWith('new file mode')) cur.create = true;
      else if (line.startsWith('deleted file mode')) cur.del = true;
    }
    i += 1;
  }
  return secs.map((s) => unifiedApply(s, s.pair ? s.pairOld : (s.renameFrom ?? s.gitOld), s.pair ? s.pairNew : (s.renameTo ?? s.gitNew), strict));
}

/** One SEARCH/REPLACE block as an edit (section 7): empty old lines create the file. */
function srApply(path: string, oldLines: string[], newLines: string[], strict: boolean): Edit {
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (oldLines.length === 0) {
      if (tree.get(path) !== null) throw new Fail('exists', path);
      tree.now.set(path, newLines.length === 0 ? '' : newLines.join('\n') + '\n');
      return;
    }
    const before = tree.get(path);
    if (before === null) throw new Fail('missing', path);
    const fl = splitText(before);
    const found = findTier(fl.lines, oldLines, strict);
    if (found === null) throw new Fail('no-match', path);
    if (found.at.length > 1) throw new Fail('ambiguous', path);
    const pos = found.at[0]!;
    const entries: BodyLine[] = [
      ...oldLines.map((t): BodyLine => ({ kind: 'old', text: t, marker: false })),
      ...newLines.map((t): BodyLine => ({ kind: 'new', text: t, marker: false })),
    ];
    fl.lines.splice(pos, oldLines.length, ...buildNew(entries, fl.lines, pos, oldLines, found.tier));
    tree.now.set(path, joinText(fl));
  };
}

/** Read SEARCH/REPLACE blocks (section 7): each block's path is the nearest usable line before it. */
function srEdits(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let lastPath: string | null = null;
  let pos = 0;
  for (;;) {
    let j = -1;
    for (let k = pos; k < lines.length; k += 1) {
      if (lines[k]!.trimEnd() === '<<<<<<< SEARCH') {
        j = k;
        break;
      }
    }
    if (j < 0) return edits;
    let path: string | null = null;
    for (let k = j - 1; k >= pos; k -= 1) {
      const l = lines[k]!;
      if (blank(l)) continue;
      if (l.trim().startsWith('```')) continue;
      path = l.trim();
      break;
    }
    if (path === null) path = lastPath;
    if (path === null) throw new Exit2(`error: parse ${j + 1}`);
    let eq = -1;
    for (let k = j + 1; k < lines.length; k += 1) {
      if (lines[k]!.trimEnd() === '=======') {
        eq = k;
        break;
      }
      if (lines[k]!.trimEnd() === '>>>>>>> REPLACE') break;
    }
    if (eq < 0) throw new Exit2(`error: parse ${j + 1}`);
    let rep = -1;
    for (let k = eq + 1; k < lines.length; k += 1) {
      if (lines[k]!.trimEnd() === '>>>>>>> REPLACE') {
        rep = k;
        break;
      }
    }
    if (rep < 0) throw new Exit2(`error: parse ${j + 1}`);
    edits.push(srApply(path, lines.slice(j + 1, eq), lines.slice(eq + 1, rep), strict));
    lastPath = path;
    pos = rep + 1;
  }
}

interface VChunk {
  anchor: string | null;
  eof: boolean;
  entries: BodyLine[];
}

function v4aAdd(path: string, fileLines: string[]): Edit {
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (tree.get(path) !== null) throw new Fail('exists', path);
    tree.now.set(path, fileLines.length === 0 ? '' : fileLines.join('\n') + '\n');
  };
}

function v4aDelete(path: string): Edit {
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (tree.get(path) === null) throw new Fail('missing', path);
    tree.now.set(path, null);
  };
}

/** One V4A Update File section (section 8): chunks apply in order behind a cursor; Move to relocates the result. */
function v4aUpdate(path: string, moveTo: string | null, chunks: VChunk[], strict: boolean): Edit {
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (moveTo !== null && !safe(moveTo)) throw new Fail('unsafe', moveTo);
    const before = tree.get(path);
    if (before === null) throw new Fail('missing', path);
    if (moveTo !== null && tree.get(moveTo) !== null) throw new Fail('exists', moveTo);
    const fl = splitText(before);
    let cursor = 0;
    for (const ch of chunks) {
      if (ch.anchor !== null) {
        const f = findTier(fl.lines, [ch.anchor], strict, cursor);
        if (f === null) throw new Fail('no-match', path);
        cursor = f.at[0]! + 1;
      }
      const o = ch.entries.filter((e) => e.kind !== 'new').map((e) => e.text);
      if (o.length === 0) {
        const add = ch.entries.filter((e) => e.kind === 'new').map((e) => e.text);
        const pos = ch.eof ? fl.lines.length : cursor;
        fl.lines.splice(pos, 0, ...add);
        cursor = pos + add.length;
        continue;
      }
      const f = findTier(fl.lines, o, strict, cursor, ch.eof ? fl.lines.length : null);
      if (f === null) throw new Fail('no-match', path);
      const pos = f.at[0]!;
      const built = buildNew(ch.entries, fl.lines, pos, o, f.tier);
      fl.lines.splice(pos, o.length, ...built);
      cursor = pos + built.length;
    }
    const out = joinText(fl);
    if (moveTo !== null) {
      tree.now.set(moveTo, out);
      tree.now.set(path, null);
      tree.moves.push([path, moveTo]);
    } else {
      tree.now.set(path, out);
    }
  };
}

/** Read a V4A patch (section 8): Begin/End Patch around Add, Delete and Update File sections. */
function v4aEdits(lines: string[], strict: boolean): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = lines.length - 1;
  while (last > first && blank(lines[last]!)) last -= 1;
  if (lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const ADD = '*** Add File: ';
  const DEL = '*** Delete File: ';
  const UPD = '*** Update File: ';
  const MOV = '*** Move to: ';
  const isHead = (l: string): boolean => l.startsWith(ADD) || l.startsWith(DEL) || l.startsWith(UPD);
  const edits: Edit[] = [];
  let i = first + 1;
  while (i < last) {
    const line = lines[i]!;
    if (blank(line)) {
      i += 1;
      continue;
    }
    if (!isHead(line)) throw new Exit2(`error: parse ${i + 1}`);
    let j = i + 1;
    while (j < last && !isHead(lines[j]!)) j += 1;
    let end = j;
    while (end > i + 1 && blank(lines[end - 1]!)) end -= 1;
    const body = lines.slice(i + 1, end);
    if (line.startsWith(ADD)) {
      const fileLines: string[] = [];
      body.forEach((l, k) => {
        if (l.startsWith('+')) fileLines.push(l.slice(1));
        else if (l === '') fileLines.push('');
        else throw new Exit2(`error: parse ${i + 2 + k}`);
      });
      edits.push(v4aAdd(line.slice(ADD.length).trim(), fileLines));
    } else if (line.startsWith(DEL)) {
      if (body.length > 0) throw new Exit2(`error: parse ${i + 2}`);
      edits.push(v4aDelete(line.slice(DEL.length).trim()));
    } else {
      const path = line.slice(UPD.length).trim();
      let moveTo: string | null = null;
      let k = 0;
      if (body.length > 0 && body[0]!.startsWith(MOV)) {
        moveTo = body[0]!.slice(MOV.length).trim();
        k = 1;
      }
      const chunks: VChunk[] = [];
      let cur: VChunk | null = null;
      let closed = false;
      for (; k < body.length; k += 1) {
        const l = body[k]!;
        const no = i + 2 + k;
        if (l.startsWith('@@')) {
          cur = { anchor: l.slice(2).trim() || null, eof: false, entries: [] };
          chunks.push(cur);
          closed = false;
        } else if (l.trim() === '*** End of File') {
          if (cur === null) throw new Exit2(`error: parse ${no}`);
          cur.eof = true;
          cur = null;
          closed = true;
        } else if (l === '' || l[0] === ' ' || l[0] === '-' || l[0] === '+') {
          if (cur === null) {
            if (chunks.length > 0 || closed) throw new Exit2(`error: parse ${no}`);
            cur = { anchor: null, eof: false, entries: [] };
            chunks.push(cur);
          }
          cur.entries.push({ kind: l === '' || l[0] === ' ' ? 'ctx' : l[0] === '-' ? 'old' : 'new', text: l === '' ? '' : l.slice(1), marker: false });
        } else {
          throw new Exit2(`error: parse ${no}`);
        }
      }
      if (chunks.length === 0 && moveTo === null) throw new Exit2(`error: parse ${i + 1}`);
      edits.push(v4aUpdate(path, moveTo, chunks, strict));
    }
    i = j;
  }
  return edits;
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    edits = kind === 'json' ? jsonEdits(text, lines) : kind === 'unified' ? unifiedEdits(lines, strict) : kind === 'search-replace' ? srEdits(lines, strict) : v4aEdits(lines, strict);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    const beforeMoves = tree.moves.length;
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      tree.moves.length = beforeMoves;
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  // A move whose old path existed before and is gone now, and whose new path is new, prints one R
  // line for the pair instead of its D and A lines, sorted by the new path (section 2).
  const movedTo = new Map<string, string>();
  const movedFrom = new Set<string>();
  for (const [o, n] of tree.moves) {
    if (movedFrom.has(o) || movedTo.has(n)) continue;
    if (tree.original(o) !== null && tree.get(o) === null && tree.original(n) === null && tree.get(n) !== null) {
      movedTo.set(n, o);
      movedFrom.add(o);
    }
  }
  const rows: { key: string; line: string }[] = [];
  for (const p of tree.now.keys()) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    if (!check) {
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
    if (movedFrom.has(p) || movedTo.has(p)) continue;
    rows.push({ key: p, line: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  for (const [n, o] of movedTo) rows.push({ key: n, line: `R ${o} -> ${n}` });
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  const out = rows.map((r) => r.line);
  return { code: 0, out: [...out, `ok: ${out.length} ${out.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
