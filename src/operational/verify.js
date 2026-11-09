/** Offline, pure verification of fictional parcel-system snapshots. */
import { createHash } from 'node:crypto';

export const OPERATIONAL_SCHEMA_VERSION = 'operational/1';

export class OperationalInputError extends Error {}

const guidance = {
  PASS: 'No action required.',
  OVERSHIPMENT: 'Review the line and shipment records; reconcile the excess manually.',
  INVALID_CANCELLATION: 'Review the cancellation and earlier shipment records; reconcile the discrepancy manually.',
  MISSING_EVIDENCE: 'Provide complete order-line and event evidence for this subject.',
  DUPLICATE_EVIDENCE: 'Review repeated source or order records and establish one authoritative record.',
  CONFLICTING_EVIDENCE: 'Reconcile conflicting source or order records before drawing a conclusion.',
  UNSCOPED_EVIDENCE: 'Identify the subject of malformed records and repeat verification.',
  STALE_EVIDENCE: 'Provide a newer complete local snapshot.',
  CUTOFF_MISMATCH: 'Export both sources at the same as-of cutoff.',
  INCOMPLETE_EVIDENCE: 'Provide source coverage through the as-of cutoff.',
  SHARED_LINEAGE: 'Review source lineage and provide evidence from a genuinely distinct upstream origin.',
  LINEAGE_MISSING: 'Document and verify the upstream origin of each source.',
  CONFLICTING_EVENT_ID: 'Resolve the conflicting event records at their source.',
  AMBIGUOUS_ORDER: 'Provide distinct event ordering keys for this line.',
  INVALID_EVIDENCE: 'Review invalid quantities or event fields in the source export.',
};

function instant(value) {
  const n = Date.parse(value);
  return typeof value === 'string' && Number.isFinite(n) && new Date(n).toISOString() === value ? n : null;
}

function requireShape(snapshot, now) {
  if (!snapshot || snapshot.schemaVersion !== OPERATIONAL_SCHEMA_VERSION ||
      !Array.isArray(snapshot.sources) || !Array.isArray(snapshot.subjects) ||
      !snapshot.policy || !Number.isFinite(snapshot.policy.maxAgeSeconds) || snapshot.policy.maxAgeSeconds < 0 ||
      typeof snapshot.policy.requireIndependentSources !== 'boolean' ||
      instant(snapshot.asOf) === null || instant(now) === null) {
    throw new OperationalInputError('Invalid operational/1 snapshot or clock');
  }
}

function evidenceFor(source, subjectId) {
  if (!source) return null;
  const records = Array.isArray(source.records) ? source.records : [];
  return {
    sourceId: source.id ?? null,
    artifactId: source.artifactId ?? null,
    lineageRoot: source.lineageRoot ?? null,
    capturedAt: source.capturedAt ?? null,
    asOf: source.asOf ?? null,
    completeThrough: source.completeThrough ?? null,
    semanticRecordHash: Array.isArray(source.records) ? createHash('sha256')
      .update(canonical([...records].map(canonical).sort())).digest('hex') : null,
    recordIds: records
      .filter((record) => isRecord(record) && record.subjectId === subjectId)
      .map((record) => record.id ?? null).sort(),
  };
}

function result(subjectId, status, reasonCode, evidence, observed = null, expected = null) {
  return {
    invariantId: 'shipment-quantity-reconciliation', subjectId, status, reasonCode,
    observed, expected, evidence,
    recovery: { action: guidance[reasonCode] },
  };
}

function sourceProblem(source, snapshot, nowMs) {
  if (!source || !Array.isArray(source.records)) return 'MISSING_EVIDENCE';
  if (!validId(source.artifactId)) return 'INVALID_EVIDENCE';
  if (!validId(source.lineageRoot)) return 'LINEAGE_MISSING';
  if (!validId(source.asOf)) return 'INVALID_EVIDENCE';
  if (source.asOf !== snapshot.asOf) return 'CUTOFF_MISMATCH';
  const captured = instant(source.capturedAt);
  const through = instant(source.completeThrough);
  const cutoff = instant(snapshot.asOf);
  if (captured === null || through === null) return 'INVALID_EVIDENCE';
  if (nowMs < cutoff || nowMs - cutoff > snapshot.policy.maxAgeSeconds * 1000) return 'STALE_EVIDENCE';
  if (through > captured) return 'INVALID_EVIDENCE';
  if (source.complete !== true || through < cutoff || captured < cutoff) return 'INCOMPLETE_EVIDENCE';
  if (captured > nowMs || nowMs - captured > snapshot.policy.maxAgeSeconds * 1000) return 'STALE_EVIDENCE';
  return null;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sameEvent(a, b) {
  return canonical(a) === canonical(b);
}

/** No filesystem, network, database, clock, or process access. */
export function verifyOperationalSnapshot(snapshot, { now }) {
  requireShape(snapshot, now);
  const nowMs = instant(now);
  const orders = snapshot.sources.find((s) => isRecord(s) && s.id === 'orders');
  const events = snapshot.sources.find((s) => isRecord(s) && s.id === 'events');
  const orderSources = snapshot.sources.filter((s) => isRecord(s) && s.id === 'orders');
  const eventSources = snapshot.sources.filter((s) => isRecord(s) && s.id === 'events');
  const duplicateSource = orderSources.length > 1 || eventSources.length > 1;
  const conflictingSource = (orderSources.length > 1 && orderSources.some((s) => !sameEvent(s, orderSources[0]))) ||
    (eventSources.length > 1 && eventSources.some((s) => !sameEvent(s, eventSources[0])));
  const sourceIssue = duplicateSource ? (conflictingSource ? 'CONFLICTING_EVIDENCE' : 'DUPLICATE_EVIDENCE') :
    sourceProblem(orders, snapshot, nowMs) ?? sourceProblem(events, snapshot, nowMs) ??
    (snapshot.policy.requireIndependentSources && orders.lineageRoot === events.lineageRoot ? 'SHARED_LINEAGE' : null);

  const unscoped = [];
  snapshot.sources.forEach((source, index) => {
    if (!isRecord(source) || !['orders', 'events'].includes(source.id)) {
      unscoped.push({ sourceId: isRecord(source) ? source.id ?? null : null,
        artifactId: isRecord(source) ? source.artifactId ?? null : null,
        lineageRoot: isRecord(source) ? source.lineageRoot ?? null : null, recordIndex: index });
    }
  });
  for (const source of [{ id: 'orders', records: orders?.records }, { id: 'events', records: events?.records }]) {
    if (!Array.isArray(source.records)) continue;
    source.records.forEach((record, index) => {
      if (!isRecord(record) || !validId(record.subjectId)) unscoped.push({
        sourceId: source.id, artifactId: source.id === 'orders' ? orders?.artifactId ?? null : events?.artifactId ?? null,
        lineageRoot: source.id === 'orders' ? orders?.lineageRoot ?? null : events?.lineageRoot ?? null,
        recordIndex: index,
      });
    });
  }
  const subjectIds = [...new Set([
    ...snapshot.subjects,
    ...(Array.isArray(orders?.records) ? orders.records.filter(isRecord).map((r) => r.subjectId) : []),
    ...(Array.isArray(events?.records) ? events.records.filter(isRecord).map((r) => r.subjectId) : []),
  ].filter(validId))].sort();
  if (subjectIds.length === 0 || snapshot.subjects.some((id) => !validId(id))) {
    throw new OperationalInputError('subjects must contain at least one nonempty string ID');
  }
  const results = [];
  const eventOwners = new Map();
  const conflictedSubjects = new Set();
  for (const event of Array.isArray(events?.records) ? events.records : []) {
    if (!isRecord(event) || !validId(event.id) || !validId(event.subjectId)) continue;
    const prior = eventOwners.get(event.id);
    if (prior && !sameEvent(prior, event)) {
      conflictedSubjects.add(prior.subjectId);
      conflictedSubjects.add(event.subjectId);
    } else eventOwners.set(event.id, event);
  }
  for (const subjectId of subjectIds) {
    const evidence = [evidenceFor(orders, subjectId), evidenceFor(events, subjectId)].filter(Boolean);
    if (sourceIssue) {
      results.push(result(subjectId, 'UNKNOWN', sourceIssue, evidence));
      continue;
    }
    const lines = orders.records.filter((r) => isRecord(r) && r.subjectId === subjectId);
    if (lines.length !== 1) {
      const reason = lines.length === 0 ? 'MISSING_EVIDENCE' :
        lines.some((r) => canonical(r) !== canonical(lines[0])) ? 'CONFLICTING_EVIDENCE' : 'DUPLICATE_EVIDENCE';
      results.push(result(subjectId, 'UNKNOWN', reason, evidence));
      continue;
    }
    if (!validId(lines[0].id)) {
      results.push(result(subjectId, 'UNKNOWN', 'INVALID_EVIDENCE', evidence));
      continue;
    }
    const ordered = lines[0].quantity;
    if (!Number.isSafeInteger(ordered) || ordered < 0) {
      results.push(result(subjectId, 'UNKNOWN', 'INVALID_EVIDENCE', evidence));
      continue;
    }
    const rawEvents = events.records.filter((e) => isRecord(e) && e.subjectId === subjectId);
    const byId = new Map();
    let conflict = false;
    let invalidId = false;
    for (const event of rawEvents) {
      if (!validId(event.id)) { invalidId = true; break; }
      const prior = byId.get(event.id);
      if (prior && !sameEvent(prior, event)) { conflict = true; break; }
      byId.set(event.id, event);
    }
    if (conflict || invalidId || conflictedSubjects.has(subjectId)) {
      results.push(result(subjectId, 'UNKNOWN', invalidId ? 'INVALID_EVIDENCE' : 'CONFLICTING_EVENT_ID', evidence));
      continue;
    }
    const uniqueEvents = [...byId.values()];
    if (uniqueEvents.some((e) => !['ship', 'cancel'].includes(e.kind) ||
        !Number.isSafeInteger(e.quantity) || e.quantity <= 0 ||
        !Number.isSafeInteger(e.sequence) || e.sequence < 0 || instant(e.occurredAt) === null)) {
      results.push(result(subjectId, 'UNKNOWN', 'INVALID_EVIDENCE', evidence));
      continue;
    }
    const active = uniqueEvents.filter((e) => instant(e.occurredAt) <= instant(snapshot.asOf));
    active.sort((a, b) => instant(a.occurredAt) - instant(b.occurredAt) || a.sequence - b.sequence);
    if (active.some((e, i) => i > 0 && e.occurredAt === active[i - 1].occurredAt && e.sequence === active[i - 1].sequence)) {
      results.push(result(subjectId, 'UNKNOWN', 'AMBIGUOUS_ORDER', evidence));
      continue;
    }
    let shipped = 0;
    let canceled = 0;
    let failure = null;
    for (const e of active) {
      const available = ordered - shipped - canceled;
      if (e.quantity > available) {
        failure = {
          reasonCode: e.kind === 'ship' ? 'OVERSHIPMENT' : 'INVALID_CANCELLATION',
          eventId: e.id, kind: e.kind, attemptedQuantity: e.quantity,
          priorValidCumulativeQuantity: e.kind === 'ship' ? shipped : canceled,
          limit: available,
        };
        break;
      }
      if (e.kind === 'ship') shipped += e.quantity;
      else canceled += e.quantity;
    }
    const observed = failure ? {
      ordered, acceptedShipped: shipped, acceptedCanceled: canceled, offendingEvent: failure,
    } : { ordered, shipped, canceled, outstanding: ordered - shipped - canceled };
    results.push(result(subjectId, failure ? 'FAIL' : unscoped.length ? 'UNKNOWN' : 'PASS',
      failure?.reasonCode ?? (unscoped.length ? 'UNSCOPED_EVIDENCE' : 'PASS'), evidence, observed,
      failure ? { maxAdditionalQuantity: failure.limit } : { shippedAtMost: ordered - canceled }));
  }
  if (unscoped.length) {
    results.push(result(null, 'UNKNOWN', 'UNSCOPED_EVIDENCE', unscoped));
  }
  const runStatus = results.some((r) => r.status === 'UNKNOWN') ? 'UNKNOWN' :
    results.some((r) => r.status === 'FAIL') ? 'FAIL' : 'PASS';
  return { schemaVersion: OPERATIONAL_SCHEMA_VERSION, asOf: snapshot.asOf, runStatus, results, errors: [] };
}
