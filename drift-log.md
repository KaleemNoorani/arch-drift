# Drift Log

A record of real findings — from arch-drift's own development and from the
one external codebase it's been validated against (anonymized; see the
[case study](README.md#case-study-translating-a-real-codebases-constraints))
— disposed by hand into one of four buckets:

- **drift** — a real, confirmed problem. Fix the code.
- **false_positive** — the check fired, but nothing was actually wrong.
  Worth asking whether it's a fixable implementation defect or an inherent
  lexical-only limitation — those are different problems with different
  fixes, and conflating them is its own way of shipping something silently
  wrong.
- **deliberate** — the flagged thing is intentional, not a bug. If one
  invariant produces many `deliberate` dispositions, that's a signal the
  invariant is mis-stated, not that the codebase collected a pile of valid
  exceptions.
- **excluded** — legitimately out of scope. Add an exemption or a named
  `except` entry with a reason; don't narrow the check to make it quiet.

A fifth, informal outcome shows up once below: **correct-but-unresolvable-
lexically** — the check fired correctly and the usage was correct, and no
signal available to a lexical (or even an AST-based) tool could have told
the two apart. That's not a disposition to fix; it's the honest ceiling of
what this class of check can do on its own.

---

## `src/cli.js` shipped with no invocation guard

**Source**: this repo, found during review round 1
**Disposition**: drift

`src/cli.js` exported `main()` but nothing ever invoked it when the file
was run directly. `node src/cli.js --config ... --target ...` silently
produced no output and exited 0 — indistinguishable from a clean run.
`bin/drift-check.js` (the actual, working entrypoint) always worked, so the
bug was invisible unless someone ran the library file directly.

**Fix**: added a standard ESM `import.meta.url === process.argv[1]`
invocation guard so direct execution behaves identically to the documented
entrypoint.

**Why it matters**: this shipped as part of "v1 done, real-run verified."
The real-run verification exercised the checker library, never the CLI
entrypoint file itself — so the exact failure mode this tool exists to
catch (a green result that means "never ran," not "ran clean") happened to
its own delivery.

---

## `--json` never implemented, despite v1 being reported complete

**Source**: this repo, found during review round 1
**Disposition**: drift

v1 was reported done and merged with no `--json` flag. `parseArgs` was
`strict: true` with only `config`/`target` declared, so passing `--json`
would have errored rather than silently ignored it — but nothing had ever
tried, because no fixture exercised CLI flags before that point.

**Fix**: added in review round 1, with a versioned JSON contract
(`schemaVersion`) rather than an ad hoc dump of internal state.

**Why it matters**: identical shape to the `cli.js` bug above — a claim of
"done" that a single real invocation would have falsified immediately. Both
gaps were closed by the same fix: `test/cli.test.js`, which shells out to
the actual documented binary instead of only exercising `runChecks()`
directly.

---

## `"nowhere"` contains `"where"` — reclassified from limitation to defect

**Source**: this repo's own fixture suite
(`test/fixtures/target/app/Http/Controllers/OrderLookupController.php`)
**Disposition**: false_positive — **implementation defect**, not inherent
limitation (reclassified)

The `suspicious_usage` checker's `near` match is a bare substring test with
no word-boundary awareness. A comment reading *"nowhere near a lookup"*
matched the near-pattern `"where"` because `"nowhere"` contains it as a
substring, flagging a line that wasn't actually near any lookup construct.

**Original classification (wrong)**: at the time this was found, it was
filed as an expected, documented false positive — "the proximity heuristic
... expected to produce false positives; those are the point of the drift
log, not a reason to narrow the window" — i.e., treated as inherent noise,
working as designed.

**Corrected classification**: this is a fixable implementation defect, not
an inherent limitation. Word-boundary matching (`\bwhere\b` instead of a
bare substring test) would eliminate this exact class of false positive
without narrowing the legitimate proximity semantics the check exists for.
"Inherent limitation" should mean *no fix exists that doesn't compromise
what the check is trying to catch* — that's not true here, so calling it
one was itself a small silent-failure: mislabeling a bug as a feature.

**Status**: not yet fixed as of this entry — a checker-behavior change was
out of scope for the branch that logged it (output-contract only). Tracked
here so it doesn't quietly stay "working as intended."

**Why it matters**: a `known_gap` is supposed to mean "this is the honest
edge of what lexical matching can do," not "we noticed a bug and decided to
call it a feature." The discipline this tool asks of a codebase — dispose
honestly, don't narrow to get to green — has to apply to the tool's own
defects too.

---

## `reversible-migrations` was mis-stated, not exception-heavy

**Source**: external validation, run 1
**Disposition**: deliberate (6 findings), leading to a rule redefinition

The original invariant flagged any migration with an empty, comment-only,
or throws-only `down()`. On the real target, 6 migrations flagged this way,
all deliberately, permanently irreversible, each with an explanatory
comment already in place.

**The reasoning that mattered**: six `deliberate` dispositions clustered on
one invariant is a signal that the invariant's *definition* is wrong — not
that six legitimate exceptions happen to exist. Treating it as "6
exceptions to grant" would have meant either six hand-maintained exemption
entries (growing forever, one per future deliberate migration) or accepting
permanent noise on every run.

**Fix**: redefined the rule itself. `method_not_empty` gained
`escape_marker` (`@architecturally-irreversible`) — a deliberately
irreversible migration now passes by explicit, on-the-record annotation,
not by exemption and not by the rule silently tolerating emptiness.

**Why it matters**: exemptions are for genuine one-offs. A pattern repeating
across many findings under one invariant means the invariant doesn't match
the codebase's actual, legitimate convention — the fix belongs in the rule,
not in a growing pile of exemption entries.

---

## Known false positive: a match inside a commented-out line

**Source**: external validation, run 1
**Disposition**: false_positive — known gap, not reclassified

A `forbidden_call`-style check matched a pattern inside a comment: the
flagged call was textually present (left over from a refactor) but not
live code.

**Root cause**: `forbidden_call`, `suspicious_usage`, and
`forbidden_dependency` all scan raw lines and do not strip comments before
matching — unlike `method_not_empty`, which strips comments for a different
reason (evaluating whether a method body is substantively empty). A
commented-out call reads identically to a live one under a line-based text
match.

**Why it matters, and why this one is filed differently from the
`"nowhere"`/`"where"` entry above**: that one was a precision bug fixable
without changing what the check looks at. This one is a structural gap in
*what* these checker types examine (comments vs. live code) — closing it
would mean adding comment-stripping to three checkers, a real behavior
change, not a one-line matching fix. Recorded, not fixed in this pass.

**Status**: verified still present, unresolved, in the second run as well —
it was not one of the sites given a named `except` entry, since it isn't a
legitimate exclusion, just an unfixed gap.

---

## 4 legitimately excluded call sites, across 2 files — not 3

**Source**: external validation, run 1 → run 2
**Disposition**: excluded

Of the frontend-request-bypass invariant's 18 run-1 violations, 4 were
disposed as legitimately out of scope: a raw blob/file `fetch()` used to
preview an already-uploaded file by URL, and a raw `fetch()` with an
`AbortController` signal for a streaming/cancelable CSV export — neither is
the shape of call the invariant exists to police. Both were given named
`except` entries with those reasons rather than silently dropped from scope.

**The site-count/file-count slip, caught the same way as the others below**:
an early description of this disposition said "3 files." Counting directly
from `drift-run-1.txt`, it's **2 files** — one of them (the blob/file
preview component) had three separate matching lines, the other had one.
3+1 = 4 sites, but that's 2 files, not 3. The tool's own exclusion-count
field reinforced the same conflation from a different angle: it counts
files removed from scope, not lines within them, so a glance at "count: 1"
per exclusion entry doesn't reveal that one of those files had three
matching lines until the pre-fix run is checked directly.

**Why it matters**: "how many things were flagged" and "how many places
they live" are different numbers, and it's easy to report one while meaning
the other — the exact class of error this whole log exists to catch, this
time in the log's own bookkeeping about an exclusion, not in a check's
output.

---

## The Perseus reversal — an external partner's webhook handler

**Source**: external validation, run 1
**Disposition**: reclassified from "real drift" (initial read) to
**correct-but-unresolvable-lexically**

The `order-number-vs-upstream-id` knowledge check (`suspicious_usage`,
watching for `order_number` near a lookup construct) fired on two sites.

One was a low-risk `LIKE` search filter — no action needed.

The second was inside an external partner's webhook handler. On first read,
this looked like the exact hazard the check exists to catch: `order_number`
— a display value — used where the internal id should be.

**What changed the disposition**: reading the surrounding contract. The
partner's documented integration contract explicitly requires `order_number`
as the shared identifier, because the partner has no visibility into
internal ids. Confirmed by the method's docblock, and by a sibling method
performing the identical match for the identical stated reason. The finding
was not a defect: the check fired correctly on the symbol, and the usage
was correct.

**Secondary observation, deliberately not hardened**: the flagged line
lacked the `OR internal_id` fallback its sibling method had. Not a defect —
the partner's contract rules out ever sending an internal id, so the
fallback the sibling method has is simply unreachable here. Recorded as an
inconsistency, deliberately left alone: adding speculative defense for a
case the contract already excludes is how invariants get diluted over time,
not how they get stronger.

**Why it matters**: the disambiguating information was a docblock and a
sibling method's documented behavior — contract knowledge, not syntax. An
AST would tell you precisely where a token sits in a parse tree. It would
not tell you that a third party's integration contract sanctions using a
display value as a shared key. This is the strongest evidence in this log
against building a semantic/AST layer for this class of invariant: the
ceiling here is what the code's surrounding contract says it means, not how
precisely the tool can locate where it says it. The disposition stands as:
keep the check — it correctly surfaces every candidate site — but it
cannot self-resolve this class of finding, and shouldn't be made to try.

---

## Three hand-maintained numbers, three independent drifts

**Source**: this repo's own README, across multiple drafts
**Disposition**: drift (in the documentation itself)

The case study's headline numbers were wrong three separate times, in three
separate ways, none of them derived from the other:

1. An original claim of "25 violations, all real" for run 1. The real,
   saved run-1 output shows **24**.
2. A first attempt at correcting that — during the very fact-check this
   entry documents — landed on "23." Still wrong. Also **24**. This
   correction was itself carried in prose (arithmetic on a remembered
   category breakdown) rather than read from the artifact.
3. A working expectation of "~15 real drift sites" going into the first
   run, stated from memory before the run existed to check it against. The
   real, disposed count was **13**.

**Why these are three drifts, not one propagating**: the gaps aren't even
the same size (25→24 is off by one; 23→24 is off by one, but the wrong
direction; 15→13 is off by two), and they trace to three different moments
— an original claim, a correction of that claim, and a pre-run expectation.
What's shared isn't a single bad number spreading. It's the same failure
mode recurring independently every time a count was carried in prose or
memory instead of read from the actual output: this project's own author
stating an expectation from memory (drift #3), then this project's own
assistant overclaiming a result (drift #1), then that same assistant
getting its own correction wrong while explicitly trying to fix drift #1
(drift #2) — a documentation defect caught only by finally reading
`drift-run-1.txt` and `drift-run-2.json` line by line instead of doing
arithmetic on what either of us remembered the categories to be.

**Why it matters**: this is the strongest instance in this entire log,
including everything above it. Every other entry here is about a check
misfiring on a codebase. This one is about the exact same failure mode
happening to the people and the assistant writing the documentation
*about* those checks — in a section of the README explicitly about not
overclaiming results. The fix, both times, was identical: stop asserting a
number and go read the file it's supposed to describe.
