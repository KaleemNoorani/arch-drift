# Arch-Drift Operational Verification — Experimental Prototype

This is an offline, synthetic-data prototype, not production-ready. Declared
provenance and completeness are not independently authenticated. This module
verifies one invented parcel-fulfillment invariant using local JSON fixtures.
It is independent of the static checker, its registry, CLI, and JSON
schema 3. The example names, records, and rules are fictional and are not
translations of any real system. The verifier has no I/O; only the separate CLI
reads a local JSON file. It never connects to a network or database or writes.

## Run

```text
node bin/operational-check.js --snapshot test/fixtures/demo-fulfillment/pass.json --now 2030-04-06T12:10:00.000Z --json
```

Both `--snapshot` and `--now` are required. The snapshot must resolve to a
regular JSON file inside `test/fixtures/demo-fulfillment`; UNC, device,
traversal, and symlink paths are rejected before its contents are read.
`--now` is an injected UTC clock,
so the same fixture and clock always produce the same result. Exit codes are
`0` for all PASS, `1` for at least one FAIL and no UNKNOWN, and `2` for any
UNKNOWN or execution error. The JSON distinguishes `runStatus: "UNKNOWN"`
from `runStatus: "ERROR"`; a mixed FAIL/UNKNOWN run retains all per-subject
results and exits `2`.

## `operational/1` input

```json
{
  "schemaVersion": "operational/1",
  "asOf": "2030-04-06T12:00:00.000Z",
  "policy": { "maxAgeSeconds": 3600, "requireIndependentSources": true },
  "subjects": ["fictional-line-id"],
  "sources": [
    {
      "id": "orders", "artifactId": "local-order-artifact", "lineageRoot": "declared-order-origin",
      "asOf": "2030-04-06T12:00:00.000Z", "capturedAt": "2030-04-06T12:05:00.000Z",
      "completeThrough": "2030-04-06T12:00:00.000Z", "complete": true,
      "records": [{ "id": "fictional-order-record", "subjectId": "fictional-line-id", "quantity": 8 }]
    },
    {
      "id": "events", "artifactId": "local-event-artifact", "lineageRoot": "declared-event-origin",
      "asOf": "2030-04-06T12:00:00.000Z", "capturedAt": "2030-04-06T12:06:00.000Z",
      "completeThrough": "2030-04-06T12:00:00.000Z", "complete": true,
      "records": [{
        "id": "fictional-event", "subjectId": "fictional-line-id", "kind": "ship",
        "quantity": 3, "occurredAt": "2030-04-06T10:00:00.000Z", "sequence": 1
      }]
    }
  ]
}
```

Times use canonical ISO UTC milliseconds. Each source declares its own as-of
cutoff, capture time, completeness through the cutoff, and upstream lineage
root. The verifier requires one `orders` and one `events` source, complete
coverage at the same cutoff, capture at or after the cutoff, and capture age
within `maxAgeSeconds`. Missing or insufficient evidence produces UNKNOWN.
`requireIndependentSources` controls whether the two declared lineage roots
must differ. Different artifact IDs, filenames, or source labels alone never
establish independence. These lineage declarations are assertions in local
fixtures; the prototype cannot audit whether an exporter stated them truthfully.

`subjects` declares required lines. Record subject IDs are also included, so
an unlisted record cannot silently disappear from the report. An order subject
must have exactly one order record. A complete event source may legitimately
contain zero events for a subject. Source artifact IDs, lineage roots, and
record IDs are required nonempty strings. Missing or malformed domain evidence
produces UNKNOWN. Duplicate and conflicting order records have distinct reason
codes. A record without an identifiable subject creates an unscoped UNKNOWN
result and prevents otherwise passing subjects from being certified; confirmed
FAIL results remain visible.

## Quantity and ordering rule

Only `ship` and `cancel` events at or before `asOf` participate. Events sort by
`(occurredAt, sequence)`, both ascending. Two distinct events with the same
ordering pair for one subject make its result UNKNOWN. Identical replays with
the same stable ID count once; conflicting contents for an ID make affected
subjects UNKNOWN. A cancellation may consume only the then-unshipped remainder.
Each shipment has the same limit. Thus a valid partial shipment can PASS with
positive outstanding quantity; an excess shipment or cancellation is FAIL.

## `operational/1` output

The report contains `schemaVersion`, `asOf`, `runStatus`, `results`, and
`errors`; CLI JSON adds `exitCode`. Each result contains `invariantId`,
`subjectId`, `status`, `reasonCode`, `observed`, `expected`, `evidence`, and
`recovery.action`. Evidence lists source/artifact IDs, declared lineage,
timestamps, sorted record IDs, and `semanticRecordHash`: SHA-256 of canonicalized
record content sorted independent of input array order. The hash identifies
semantic content but does not prove source independence. FAIL observations
identify the offending event, attempted quantity, accepted prefix totals, and
limit; accepted prefix totals are not presented as the full attempted total.
Recovery text advises manual investigation only;
the tool never executes it. UNKNOWN means evidence did not support a verdict;
ERROR means loading or input validation failed.

## Limits

The prototype trusts local declarations of completeness and lineage, does not
authenticate artifacts, and does not implement returns, voids, or adjustments.
There is no data-source adapter. A future adapter would need its own design and
review before using non-synthetic data. No static checker contract changes are
needed for this prototype.
