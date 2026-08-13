import { readFile } from 'node:fs/promises';

export class ConfigError extends Error {}

function assert(cond, message) {
  if (!cond) throw new ConfigError(message);
}

function validateChecks(owner, checks) {
  assert(Array.isArray(checks) && checks.length > 0, `${owner}: 'checks' must be a non-empty array`);
  checks.forEach((c, i) => {
    assert(typeof c.type === 'string', `${owner}: checks[${i}] missing 'type'`);
  });
}

function validate(doc) {
  assert(typeof doc === 'object' && doc !== null, 'architecture.json must be a JSON object');
  assert(typeof doc.phase === 'string', "'phase' must be a string");
  assert(Array.isArray(doc.phases), "'phases' must be an array");
  assert(doc.phases.includes(doc.phase), `current phase '${doc.phase}' is not present in 'phases'`);
  assert(Array.isArray(doc.invariants), "'invariants' must be an array");

  doc.invariants.forEach((inv, i) => {
    const owner = `invariants[${i}]`;
    assert(typeof inv.id === 'string', `${owner}: missing 'id'`);
    assert(inv.severity === 'violation' || inv.severity === 'advisory' || inv.severity === undefined,
      `${owner} (${inv.id}): 'severity' must be 'violation' or 'advisory' if present`);
    if (inv.phases !== undefined) {
      assert(Array.isArray(inv.phases), `${owner} (${inv.id}): 'phases' must be an array`);
    }
    validateChecks(`${owner} (${inv.id})`, inv.checks);
  });

  (doc.exemptions ?? []).forEach((ex, i) => {
    const owner = `exemptions[${i}]`;
    assert(typeof ex.invariant === 'string', `${owner}: missing 'invariant'`);
    assert(typeof ex.valid_through === 'string', `${owner}: missing 'valid_through'`);
    assert(doc.phases.includes(ex.valid_through),
      `${owner}: valid_through '${ex.valid_through}' is not present in 'phases'`);
  });

  (doc.knowledge ?? []).forEach((k, i) => {
    const owner = `knowledge[${i}]`;
    assert(typeof k.id === 'string', `${owner}: missing 'id'`);
    if (k.checks !== undefined) validateChecks(`${owner} (${k.id})`, k.checks);
  });
}

export async function loadConfig(configPath) {
  let raw;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (err) {
    throw new ConfigError(`Could not read config file '${configPath}': ${err.message}`);
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`Config file '${configPath}' is not valid JSON: ${err.message}`);
  }

  validate(doc);
  return doc;
}

export function isActiveForPhase(phases, currentPhase) {
  if (phases === undefined) return true;
  return phases.includes(currentPhase);
}

export function phaseIndex(phasesList, phase) {
  const idx = phasesList.indexOf(phase);
  if (idx === -1) throw new ConfigError(`phase '${phase}' not found in 'phases' list`);
  return idx;
}
