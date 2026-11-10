<p align="center">
  <img src="assets/arch-drift-logo.png" alt="Arch-Drift logo" width="180">
</p>

# arch-drift

A small, dependency-light checker that verifies a codebase against architectural
decisions a human wrote down in `architecture.json`.

## Why it exists

Some architectural decisions exist only because someone made them: a boundary
drawn on purpose, a rule adopted for a stated reason. Nothing in the code's
current shape recovers them, so they drift, especially in a long,
agent-assisted build. Arch-Drift keeps the decision, a deterministic check for
the part that can be mechanized, and the context that can't be proven from code
in one declarative file. It never modifies the target or `architecture.json`;
a human owns that file.

The static checker is **lexical**: it reads files as text, with no AST for
most checkers. See [Limits](#limits) before relying on it.

## Quick start

Requires Node.js 20 or newer.

```sh
git clone https://github.com/KaleemNoorani/arch-drift.git
cd arch-drift
npm ci
node bin/drift-check.js --config test/fixtures/architecture.json --target test/fixtures/target
```

`--config` and `--target` are both required; there is no default target. The
fixture is a fictional museum website that intentionally contains violations,
so this command exits `1`. On Windows PowerShell, use `npm.cmd` in place of
`npm`.

## Example

A rule from the fixture: rendering a preview must not flush the shared cache,
while an administrator's reset method in the same file may.

```json
{
  "id": "preview-cache-safety",
  "rationale": "An administrator reset is a different method in the same fictional service.",
  "severity": "violation",
  "checks": [
    {
      "type": "method_body_forbids",
      "method": "renderPreview",
      "patterns": ["PreviewCache::flush(", "->flush()"],
      "scope": ["app/Services/PreviewCacheService*.php"]
    }
  ]
}
```

Result (abridged):

```
[preview-cache-safety] app/Services/PreviewCacheService.php:40
  matched: PreviewCache::flush($pageId);
  rationale: An administrator reset is a different method in the same fictional service.
```

The identical call in `resetPreviewCache`, and the same text inside comments,
strings, heredocs, and nowdocs, are not reported. A file whose method boundary
cannot be determined is listed as `unresolvable` and is never scanned.

## Features

- Declarative rules (`invariants[]`), each with a rationale, a severity
  (`violation` or `advisory`), and one or more checks.
- Phases and time-boxed `exemptions[]`; an expired exemption stops suppressing
  its finding.
- Named `except` exclusions that keep their reason in the report.
- `knowledge[]` entries for claims that can't be checked, including
  `unconfirmed` ones that always surface in the report.
- A status for every invariant, so "ran clean" is distinguishable from "matched
  no files" and "could not verify".
- A versioned `--json` report for other tools.

## Checker types

| type | what it does |
| --- | --- |
| `forbidden_call` | flags scoped files containing literal call patterns |
| `forbidden_dependency` | flags forbidden package names in root-level manifest files |
| `config_value_allowlist` | checks a PHP config key's literal value against an allowlist |
| `method_not_empty` | flags empty, comment-only, or throws-only method bodies unless an `escape_marker` is present |
| `handler_present` | flags files missing required handling patterns, or containing risky ones |
| `suspicious_usage` | flags a symbol appearing within N characters of given patterns |
| `method_body_forbids` | **PHP only.** Flags forbidden patterns inside one named method's body |

`suspicious_usage` matches plain substrings by default, so `where` also matches
inside `nowhere`. Set `"word_boundary": true` on a check to require whole-token
matches; existing configs are unaffected. Details for every type are in the
[checker reference](docs/CHECKER-REFERENCE.md).

## Reports and exit codes

By default the report is human-readable. `--json` prints a versioned
(`schemaVersion` `"3"`) contract for external tooling instead.

| exit | meaning |
| --- | --- |
| `0` | clean: no unsuppressed violation-severity findings |
| `1` | at least one unsuppressed violation-severity finding |
| `2` | tool or config error (malformed config, unreadable target, unknown checker type) |

Errors outrank violations because the run was incomplete. Advisories never
change the exit code. `unresolvable` files also don't change the exit code: a
file in `unresolvable[]` was never checked, so a consumer that must gate on it
(for example a pre-merge hook) should read that field. See the
[report contract](docs/STATIC-REPORT-CONTRACT.md).

```sh
node bin/drift-check.js --config test/fixtures/architecture.json --target test/fixtures/target --json
```

## Limits

- Checks are lexical: file reading, regexes, and globs. A check can surface
  candidates but cannot establish intent or semantics.
- `method_body_forbids` uses a hand-written PHP scanner that masks strings,
  comments, heredocs, and nowdocs. It is not a parser and is PHP-only. When it
  cannot bound a method it reports `unresolvable` instead of guessing.
- `suspicious_usage` is a proximity heuristic and can report false positives.
- Everything here is verified against the repository's synthetic fixtures. No
  claim is made about accuracy on any real-world codebase.

## Experimental operational verifier

A separate, offline prototype that checks a fictional parcel invariant (shipped
quantity must not exceed ordered quantity) against local JSON snapshots. It has
no database or network adapter and takes an explicit `--now`. Evidence that is
incomplete or stale yields **UNKNOWN**, never a silent pass.

```sh
node bin/operational-check.js --snapshot test/fixtures/demo-fulfillment/pass.json --now 2030-04-06T12:10:00.000Z --json     # PASS, exit 0
node bin/operational-check.js --snapshot test/fixtures/demo-fulfillment/fail.json --now 2030-04-06T12:10:00.000Z --json     # FAIL, exit 1
node bin/operational-check.js --snapshot test/fixtures/demo-fulfillment/unknown.json --now 2030-04-06T12:10:00.000Z --json  # UNKNOWN, exit 2
node bin/operational-check.js --snapshot test/fixtures/demo-fulfillment/pass.json --now 2030-04-06T13:10:00.000Z --json     # stale: UNKNOWN, exit 2
```

It is a prototype and not production-ready. Declared provenance and
completeness in a snapshot are **not** independently authenticated. See the
[operational prototype contract](docs/OPERATIONAL-PROTOTYPE.md) (`operational/1`).

## Documentation

- [Checker reference](docs/CHECKER-REFERENCE.md): scope, every checker type and option, `architecture.json` shape
- [Static report contract](docs/STATIC-REPORT-CONTRACT.md): `--json` schema 3, statuses, human report
- [PHP method scope](docs/PHP-METHOD-SCOPE.md): how `method_body_forbids` bounds methods and fails safe
- [Operational prototype](docs/OPERATIONAL-PROTOTYPE.md): the experimental verifier's contract
- [Checker backlog](docs/CHECKER-BACKLOG.md): proposed, unimplemented checkers
- [Positioning](docs/POSITIONING.md) and [synthetic walkthrough](docs/SYNTHETIC-WALKTHROUGH.md)
- [drift-log.md](drift-log.md): the project's own defects and design decisions
- [examples/architecture.json](examples/architecture.json): a full worked config

## Development

```sh
npm ci
npm test
```

`test/fixtures/` is a permanent, synthetic PHP/JS target tree with two
`architecture.json` variants that exercise every checker type, both exemption
states, the error path, and the knowledge section. Re-run the suite whenever
checker behavior changes. CI runs on Node 20 and 22.
