# Synthetic walkthrough

This walkthrough uses only the fictional `test/fixtures/target`
tree. Its rules are invented to exercise Arch-Drift's checker contracts; no
result below is a measurement of a production system. The static fixture
models a community-museum website with scheduled theme activation, built-in
exhibit rendering, reversible migrations, and preview-cache safety.

Run the static checker from the repository root:

```sh
node bin/drift-check.js --config test/fixtures/architecture.json --target test/fixtures/target --json
```

The synthetic target deliberately contains violations, so the command exits
`1`. Its JSON uses `schemaVersion: "3"`. Invariant statuses include
`violated`, `advisory_only`, `clean`, `no_targets_matched`,
`skipped_by_phase`, and `unresolvable`. For example, the
`preview-cache-safety` check reports executable cache-flush calls inside
`renderPreview`, ignores identical text in comments and literals, and
reports a malformed method boundary separately as unresolvable. A confirmed
violation remains visible alongside that coverage gap.

The fixture also includes an active exemption, an expired exemption, a
named exclusion, a deliberate migration marker, and an unknown checker type
in a separate error config. They exercise reporting paths; they do not
stand in for real incidents. See [drift-log.md](../drift-log.md) for
project-internal defects and the explicitly labeled synthetic exercise.

The separate [operational walkthrough](#operational-walkthrough)
uses fictional parcel snapshots to show PASS, FAIL, UNKNOWN, and stale
evidence without making any production-readiness claim.

## Operational walkthrough

Run from the repository root.

It reads only JSON files in `test/fixtures/demo-fulfillment`, uses an explicit
`--now` value, and has no database or network adapter. Its synthetic parcel
lines illustrate three outcomes:

```sh
node bin/operational-check.js --snapshot test/fixtures/demo-fulfillment/pass.json --now 2030-04-06T12:10:00.000Z --json
node bin/operational-check.js --snapshot test/fixtures/demo-fulfillment/fail.json --now 2030-04-06T12:10:00.000Z --json
node bin/operational-check.js --snapshot test/fixtures/demo-fulfillment/unknown.json --now 2030-04-06T12:10:00.000Z --json
node bin/operational-check.js --snapshot test/fixtures/demo-fulfillment/pass.json --now 2030-04-06T13:10:00.000Z --json
```

In the fictional walkthrough, `parcel-line-aurora` ordered eight units and
shipped three: the remaining five are allowed, so the result is **PASS**
(exit `0`). `parcel-line-comet` ordered four but has a five-unit shipment:
**FAIL** (exit `1`). `parcel-line-nebula` has an event source whose declared
coverage ends before the as-of cutoff: **UNKNOWN** (exit `2`). An incomplete
source cannot establish that no further shipments occurred, so it cannot
silently produce PASS. The fourth command reuses the passing fixture with a
later clock; its evidence is stale and yields **UNKNOWN** (exit `2`) rather
than a false PASS. Declared provenance and completeness are not independently
authenticated.

See [the operational prototype contract](OPERATIONAL-PROTOTYPE.md) for
ordering, evidence, recovery guidance, and JSON fields. These commands use
only original synthetic fixtures and do not exercise production systems.
