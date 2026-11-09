import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { check } from '../src/checkers/suspicious_usage.js';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'bin', 'drift-check.js');

/** Runs the checker on one synthetic file; returns the findings array. */
async function run(source, params) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arch-drift-su-'));
  try {
    await writeFile(path.join(dir, 'a.txt'), source, 'utf8');
    return await check({ scope: ['*.txt'], window_chars: 20, ...params }, {}, { targetDir: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const hits = async (source, params) => (await run(source, params)).length;

test('default (word_boundary absent or false): legacy substring behavior unchanged', async () => {
  const p = { symbol: 'slug', near: ['where'] };
  assert.equal(await hits('slug nowhere', p), 1);
  assert.equal(await hits('slug nowhere', { ...p, word_boundary: false }), 1);
  assert.equal(await hits('slug somewhere', p), 1);
  assert.equal(await hits('slug whereIn', p), 1);
  assert.equal(await hits('slug where_', p), 1);
  assert.equal(await hits('slug where2', p), 1);
});

test('word_boundary: standalone word matches', async () => {
  const p = { symbol: 'slug', near: ['where'], word_boundary: true };
  assert.equal(await hits('slug where', p), 1);
  assert.equal(await hits('where slug', p), 1);
  assert.equal(await hits('slug.where(', p), 1);
  assert.equal(await hits('slug, where;', p), 1);
});

test('word_boundary: embedded substrings do not match', async () => {
  const p = { symbol: 'slug', near: ['where'], word_boundary: true };
  for (const src of ['slug nowhere', 'slug somewhere', 'slug whereIn', 'slug where_', 'slug where2', 'slug _where']) {
    assert.equal(await hits(src, p), 0, src);
  }
});

test('word_boundary: case sensitivity unchanged in both modes', async () => {
  assert.equal(await hits('slug Where', { symbol: 'slug', near: ['where'] }), 0);
  assert.equal(await hits('slug Where', { symbol: 'slug', near: ['where'], word_boundary: true }), 0);
  assert.equal(await hits('Slug where', { symbol: 'slug', near: ['where'], word_boundary: true }), 0);
});

test('word_boundary: non-word edges stay literal (->where, ->where(, DB::, DB::table)', async () => {
  const wb = (near) => ({ symbol: 'slug', near, word_boundary: true });
  // Leading non-word edge: no constraint before, last char is word so constrained after.
  assert.equal(await hits('slug x->where', wb(['->where'])), 1);
  assert.equal(await hits('slug ->wherever', wb(['->where'])), 0);
  // Both edges non-word: fully literal.
  assert.equal(await hits('slug x->where(', wb(['->where('])), 1);
  assert.equal(await hits('slug ->where(1)', wb(['->where('])), 1);
  // Trailing non-word edge: leading word char is constrained before.
  assert.equal(await hits('slug DB::', wb(['DB::'])), 1);
  assert.equal(await hits('slug XDB::', wb(['DB::'])), 0);
  assert.equal(await hits('slug DB:: x', wb(['DB::'])), 1);
  // Word edges both sides, punctuation inside matched literally.
  assert.equal(await hits('slug DB::table', wb(['DB::table'])), 1);
  assert.equal(await hits('slug DB::tables', wb(['DB::table'])), 0);
  assert.equal(await hits('slug myDB::table', wb(['DB::table'])), 0);
  // Legacy mode for the same inputs still substring-matches.
  assert.equal(await hits('slug ->wherever', { symbol: 'slug', near: ['->where'] }), 1);
});

test('word_boundary: symbol boundaries apply independently of near', async () => {
  const p = { near: ['where'], word_boundary: true };
  assert.equal(await hits('display_slug where', { ...p, symbol: 'slug' }), 0);
  assert.equal(await hits('slugs where', { ...p, symbol: 'slug' }), 0);
  assert.equal(await hits('(slug) where', { ...p, symbol: 'slug' }), 1);
  // Legacy: symbol is a plain substring.
  assert.equal(await hits('display_slug where', { symbol: 'slug', near: ['where'] }), 1);
});

test('word_boundary: underscore, digits, and camelCase neighbours are word characters', async () => {
  const p = { symbol: 'slug', near: ['where'], word_boundary: true };
  assert.equal(await hits('slug firstWhere', { ...p, near: ['Where'] }), 0);
  assert.equal(await hits('slug whereFirst', p), 0);
  assert.equal(await hits('slug 2where', p), 0);
});

test('word_boundary: Unicode letters and numerals adjacent to a pattern block the match', async () => {
  const p = { symbol: 'slug', near: ['where'], word_boundary: true };
  assert.equal(await hits('slug éwhere', p), 0);
  assert.equal(await hits('slug whereé', p), 0);
  assert.equal(await hits('slug ٣where', p), 0); // Arabic-Indic digit
  assert.equal(await hits('slug where٣', p), 0);
  assert.equal(await hits('slug 漢where', p), 0);
  assert.equal(await hits('slug —where—', p), 1); // dash punctuation is not a word char
});

test('word_boundary: astral letters/numbers are read by code point, not UTF-16 unit', async () => {
  const p = { symbol: 'slug', near: ['where'], word_boundary: true };
  assert.equal(await hits('slug \u{1D41A}where', p), 0); // MATHEMATICAL BOLD SMALL A (letter) before
  assert.equal(await hits('slug where\u{1D41A}', p), 0); // letter after
  assert.equal(await hits('slug \u{1D7CE}where', p), 0); // MATHEMATICAL BOLD DIGIT ZERO (number) before
  assert.equal(await hits('slug where\u{1D7CE}', p), 0); // number after
  assert.equal(await hits('slug \u{1F600}where\u{1F600}', p), 1); // emoji are not word chars
  // A pattern ending in an astral letter is constrained after it.
  assert.equal(await hits('slug w\u{1D41A}', { ...p, near: ['w\u{1D41A}'] }), 1);
  assert.equal(await hits('slug w\u{1D41A}x', { ...p, near: ['w\u{1D41A}'] }), 0);
});

test('word_boundary: clipped window edges never create a whole-token match', async () => {
  // Window-end: with window_chars 6 the window is exactly "slug where"; the 'r' that
  // makes it "whererr..." lies just outside the window and must still block the match.
  const end = { symbol: 'slug', near: ['where'], window_chars: 6, word_boundary: true };
  assert.equal(await hits('slug wherer', end), 0);
  assert.equal(await hits('slug where', end), 1);
  assert.equal(await hits('slug wherer', { ...end, word_boundary: false }), 1);
  // Window-start: symbol follows "nowhere" such that window begins exactly at "where".
  const src = 'nowhere' + ' slug';
  const windowChars = ' slug'.length + 'where'.length - 'slug'.length; // window starts at "where"
  const params = { symbol: 'slug', near: ['where'], window_chars: windowChars, word_boundary: true };
  assert.equal(await hits(src, params), 0);
  assert.equal(await hits(src, { ...params, word_boundary: false }), 1);
});

test('word_boundary: window distance is not widened to satisfy a boundary', async () => {
  const p = { symbol: 'slug', near: ['where'], window_chars: 3, word_boundary: true };
  // "where" is 5+ chars away from the symbol: outside the window in both modes.
  assert.equal(await hits('slug      where', p), 0);
  assert.equal(await hits('slug      where', { ...p, word_boundary: false }), 0);
});

test('word_boundary: a later valid occurrence in the same window still matches', async () => {
  const p = { symbol: 'slug', near: ['where'], window_chars: 40, word_boundary: true };
  assert.equal(await hits('slug nowhere, then where', p), 1);
  assert.equal(await hits('slug nowhere, then somewhere', p), 0);
  // Several near patterns: the first listed pattern fails, a later one qualifies.
  assert.equal(await hits('slug nowhere find', { ...p, near: ['where', 'find'] }), 1);
});

test('word_boundary: matchedText is still the raw clipped source window; line numbers preserved', async () => {
  const findings = await run('line one\nslug  where\nline three', {
    symbol: 'slug', near: ['where'], window_chars: 8, word_boundary: true,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
  assert.equal(findings[0].matchedText, 'ine one slug where');
  assert.equal(findings[0].file, 'a.txt');
});

test('invalid word_boundary or empty patterns are rejected, not silently coerced', async () => {
  const base = { symbol: 'slug', near: ['where'] };
  for (const bad of ['true', 1, 0, null, {}, []]) {
    await assert.rejects(run('slug where', { ...base, word_boundary: bad }), /'word_boundary' must be a boolean/);
  }
  // Empty / non-string patterns are rejected identically in legacy and word_boundary modes.
  for (const mode of [{}, { word_boundary: false }, { word_boundary: true }]) {
    for (const badSymbol of ['', 1, null, undefined, {}, ['slug']]) {
      await assert.rejects(
        run('slug where', { ...base, ...mode, symbol: badSymbol }),
        /'symbol' must be a non-empty string/,
        `symbol=${JSON.stringify(badSymbol)} mode=${JSON.stringify(mode)}`
      );
    }
    for (const badNear of ['', 1, null, {}, ['slug']]) {
      await assert.rejects(
        run('slug where', { ...base, ...mode, near: [badNear] }),
        /'near' entries must be a non-empty string/,
        `near=${JSON.stringify(badNear)} mode=${JSON.stringify(mode)}`
      );
    }
  }
});

async function cliWith(checkParams) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arch-drift-cli-'));
  const targetDir = path.join(dir, 'target');
  await import('node:fs/promises').then((fs) => fs.mkdir(targetDir));
  await writeFile(path.join(targetDir, 'a.txt'), 'slug nowhere\n', 'utf8');
  const config = {
    phase: 'p', phases: ['p'],
    invariants: [{
      id: 'inv', severity: 'violation', rationale: 'r',
      checks: [{ type: 'suspicious_usage', symbol: 'slug', near: ['where'], window_chars: 20, scope: ['*.txt'], ...checkParams }],
    }],
  };
  const configPath = path.join(dir, 'architecture.json');
  await writeFile(configPath, JSON.stringify(config), 'utf8');
  try {
    const { stdout } = await execFileAsync(process.execPath, [bin, '--config', configPath, '--target', targetDir, '--json']);
    return { code: 0, json: JSON.parse(stdout) };
  } catch (err) {
    return { code: err.code, json: JSON.parse(err.stdout) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('CLI: word_boundary true removes the substring false positive (exit 0, schema 3)', async () => {
  const legacy = await cliWith({});
  assert.equal(legacy.code, 1);
  assert.equal(legacy.json.schemaVersion, '3');
  assert.equal(legacy.json.violations.length, 1);

  const strict = await cliWith({ word_boundary: true });
  assert.equal(strict.code, 0);
  assert.equal(strict.json.schemaVersion, '3');
  assert.equal(strict.json.violations.length, 0);
});

test('CLI: non-boolean word_boundary -> JSON errors[] populated and exit 2', async () => {
  for (const bad of ['true', 1, null, {}]) {
    const { code, json } = await cliWith({ word_boundary: bad });
    assert.equal(code, 2, JSON.stringify(bad));
    assert.equal(json.exitCode, 2);
    assert.equal(json.errors.length, 1);
    assert.match(json.errors[0].message, /'word_boundary' must be a boolean/);
  }
});

test('CLI: empty or non-string symbol/near -> JSON errors[] populated and exit 2', async () => {
  for (const params of [
    { symbol: '' }, { symbol: 5 },
    { near: [''] }, { near: [7] },
    { symbol: '', word_boundary: true }, { near: [''], word_boundary: true },
  ]) {
    const { code, json } = await cliWith(params);
    assert.equal(code, 2, JSON.stringify(params));
    assert.equal(json.exitCode, 2);
    assert.equal(json.errors.length, 1);
    assert.match(json.errors[0].message, /must be a non-empty string/);
  }
});

test('CLI: documented static fixture command still exits 1 (fixture contains violations)', async () => {
  const repoRoot = path.join(here, '..');
  try {
    await execFileAsync(process.execPath, [
      bin, '--config', path.join(here, 'fixtures', 'architecture.json'),
      '--target', path.join(here, 'fixtures', 'target'), '--json',
    ]);
    assert.fail('expected exit 1');
  } catch (err) {
    assert.equal(err.code, 1);
    assert.equal(JSON.parse(err.stdout).schemaVersion, '3');
  }
  assert.ok(repoRoot);
});
