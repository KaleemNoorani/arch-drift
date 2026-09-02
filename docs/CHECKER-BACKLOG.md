# Checker backlog

Invariants encountered in a real codebase during a translation pass, found to be
file-local (evaluable from one file's own contents) but **not expressible by any
of the six v1 checker types**. Grouped by the checker type each would need. All
examples below are illustrative -- domain names are stand-ins, not the source
codebase's real identifiers, in the same spirit as `examples/architecture.json`.

Three more invariants surfaced in the same pass that don't belong in this
document at all -- see "Also observed, not backlog material" at the end. Forcing
them into one of the three buckets below would be dishonest about what they
actually need.

---

## 1. Method-scoped pattern checking (`method_body_forbids` / `method_body_contains`)

**This is the one to build first.** It's the clearest story of the three, because
it's not a hypothetical shape mismatch -- it's a real invariant that currently has
no safe way to be gated at all, in a codebase already using this tool.

### Motivating example: lineage-preserving deletes

A warehouse-inventory service has a core lineage-tracking table (call it
`inventory_units`). The real invariant, straight from the codebase's own
documentation of *why* it matters:

> A full-quantity move updates the SAME row's location in place; a partial move
> decrements the source and creates a linked child via a parent-unit reference.
> Any new code that deletes a unit row instead of following this pattern breaks
> the audit trail's ability to trace lineage.

So the rule is really: **inside the move function, a hard delete is forbidden.
Everywhere else, it's fine** -- there are two other real, legitimate reasons the
same codebase deletes rows from that same table, both living in the *same shared
service class* as the move function:

1. **Voiding a receipt** that was a mistake -- explicitly documented as
   destructive, gated by a real safety check that blocks it once the stock has
   already moved/allocated/picked.
2. **A staging-only test-data cleanup command** that removes synthetic rows a
   test-data generator created.

Three real call sites, one file, two different verdicts depending on *which
method* the delete lives in.

`forbidden_call`'s scope is file-granular, not method-granular (the README
already documents this exact limitation for a different invariant). Given that,
there were only two honest options for the real invariant above:

- **Write it as a blanket file-scope `forbidden_call`** on the delete pattern.
  Rejected: it fires on 3 pieces of already-correct, already-shipped code the
  moment it's written, including code nobody had reviewed for this specific
  purpose yet. A rule whose first act is to declare the existing codebase
  wrong isn't ready.
- **Pre-exempt the 3 known sites via `except`.** Also rejected, for a sharper
  reason: an `except` list doesn't encode "these are the *only* legitimate
  reasons to delete here," it encodes "these are the sites nobody's gotten
  around to objecting to yet." The next legitimate delete site added to the
  file — or the next illegitimate one — looks identical to the exemption list
  until a human notices. It trains people to add an exemption to get unblocked,
  which is worse than no gate at all.

Net result: **no rule shipped.** The invariant is real, documented, and
completely unenforceable by v1 today.

### What the checker needs

```json
{
  "type": "method_body_forbids",
  "method": "moveUnit",
  "patterns": ["DELETE FROM inventory_units", "->delete()"],
  "scope": ["app/Services/InventoryService.php"]
}
```

Extract one named method's body (the brace-matching approach `method_not_empty`
already has is most of the way there), then run `forbidden_call`'s pattern-match
logic against *just that body* instead of the whole file. `method_not_empty`
already proves the extraction half of this is tractable; it just checks
emptiness/throw-only today instead of arbitrary content.

### Second example: required transaction wrapping

Same shape, positive form. A large shared service class wraps its methods in an
outer, controller-level transaction by default -- except 8 specific methods,
which are called from more than one entry point (a webhook path and a direct
user action, say), not all of which apply that outer wrap. Those 8 are required
to *also* wrap themselves individually:

```json
{
  "type": "method_body_contains",
  "methods": ["createRecord", "updateRecord", "processReceipt", "..."],
  "requires_any": ["DB::transaction("],
  "scope": ["app/Services/InventoryService.php"]
}
```

Same underlying primitive as the delete-lineage case (extract named method body,
pattern-match within it) -- `_forbids` and `_contains` are the same checker with
the pass/fail sense flipped, and probably belong as one checker type with a
`requires_any` vs. `forbidden` param choice rather than two.

---

## 2. Ordering-aware route checking (`route_order`)

A REST resource's literal-path sibling routes must be registered before its
parameterized detail route on the same path prefix:

```
GET /resource/by-code/{code}   <- must come first
GET /resource/{id}             <- or this silently swallows "by-code" as the id
```

Real invariant, one file (the route table), but the violation is about the
*relative order* of two route declarations, not the presence or absence of a
pattern. None of the six v1 checkers understand sequence/ordering at all --
each one evaluates lines/files independently. Needs a checker that walks route
declarations for a given resource prefix in file order and flags a parameterized
segment appearing before a literal sibling that shares its prefix.

```json
{
  "type": "route_order",
  "scope": ["routes/api.php"],
  "resource_prefix": "resource"
}
```

---

## 3. Argument-position checking (`arg_position`)

A shared HTTP-request helper used across the frontend --
`apiRequest(method, path, body, queryParams)` -- has the request body as its
3rd positional argument and query-string params as its 4th. A caller who
transposes them sends the intended body as a query string (and vice versa) with
no error at any layer -- it's a silent behavior change, not a crash.

Lexical substring matching can find every *call site* of `apiRequest(` trivially
(`suspicious_usage` already does exactly this kind of proximity match) — it just
can't tell whether the 3rd and 4th arguments are in the right order, because
that requires actually parsing the call's argument list, not just noticing it
exists nearby. This is a real step up in mechanism from every other v1 checker:
the first one that needs a call-site *parser*, even a small bespoke one, rather
than pattern text on a line.

```json
{
  "type": "arg_position",
  "call": "apiRequest(",
  "warn_if_arg_matches": {
    "index": 2,
    "looks_like": ["queryParams", "params", "query"]
  },
  "scope": ["resources/js/**/*.js", "resources/js/**/*.vue"]
}
```

(Sketch only -- the exact detection heuristic for "this argument looks like it
was meant for the other slot" needs real design, not just a shape guess. This
entry exists to record that the *class* of check is needed, not that the
params above are ready to implement.)

---

## Also observed, not backlog material

Three more invariants from the same pass don't belong above -- each for a
different, specific reason, not just "also hard":

- **A config value that's hardcoded regardless of an env override that
  theoretically exists.** On inspection this isn't a "must never" rule at all --
  it's a factual note about current behavior (a gotcha), not something with a
  violating and a non-violating state. There's nothing for any checker, lexical
  or otherwise, to gate here.
- **A database column's uniqueness constraint must be scoped globally, not
  per-parent-row.** This needs a checker that understands migration schema
  *declarations* (does this `Schema::table` call declare a unique index at the
  right scope) -- a fundamentally different primitive from anything above
  (pattern-in-file, order-of-declarations, or argument-position). Worth its own
  backlog entry once there's a second real example of it, not speculatively
  designed from one.
- **A feature's "this counts as committed" boundary is a specific user action,
  not an earlier-seeming one in the same flow.** This is pure runtime workflow
  semantics -- which action happens to run last in a sequence a user chooses
  interactively. No amount of checker sophistication makes this lexical; it
  needs an entirely different verification approach (an integration test, not
  a static check), not a v2 checker type.
