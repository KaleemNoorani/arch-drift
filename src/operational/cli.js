import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { verifyOperationalSnapshot, OPERATIONAL_SCHEMA_VERSION } from './verify.js';
import { resolveLocalSnapshot } from './localSnapshot.js';

const usage = 'Usage: operational-check --snapshot <local-json-file> --now <ISO-UTC-time> [--json]';

export async function main(argv) {
  let values;
  const jsonRequested = argv.includes('--json');
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { snapshot: { type: 'string' }, now: { type: 'string' }, json: { type: 'boolean' } },
      strict: true,
    }));
    if (!values.snapshot || !values.now) throw new Error(usage);
    const snapshotPath = await resolveLocalSnapshot(values.snapshot);
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
    const report = verifyOperationalSnapshot(snapshot, { now: values.now });
    const exitCode = report.runStatus === 'PASS' ? 0 : report.runStatus === 'FAIL' ? 1 : 2;
    if (values.json) console.log(JSON.stringify({ ...report, exitCode }, null, 2));
    else {
      for (const row of report.results) console.log(`${row.subjectId}: ${row.status} (${row.reasonCode})`);
      console.log(`Run: ${report.runStatus}`);
    }
    return exitCode;
  } catch (err) {
    const report = {
      schemaVersion: OPERATIONAL_SCHEMA_VERSION, runStatus: 'ERROR', results: [],
      errors: [{ code: 'EXECUTION_ERROR', message: err.message }], exitCode: 2,
    };
    if (jsonRequested) console.log(JSON.stringify(report, null, 2));
    else console.error(`${err.message}\n${usage}`);
    return 2;
  }
}
