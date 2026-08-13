import { parseArgs } from 'node:util';
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { loadConfig, ConfigError } from './config.js';
import { runChecks } from './run.js';
import { renderReport } from './report.js';

const USAGE = 'Usage: drift-check --config <path-to-architecture.json> --target <path-to-codebase>';

/** Returns the process exit code. Never throws for expected user/config errors. */
export async function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        config: { type: 'string' },
        target: { type: 'string' },
      },
      strict: true,
    }));
  } catch (err) {
    console.error(`Argument error: ${err.message}\n${USAGE}`);
    return 2;
  }

  if (!values.config || !values.target) {
    console.error(USAGE);
    return 2;
  }

  const configPath = path.resolve(values.config);
  const targetDir = path.resolve(values.target);

  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    console.error(`Target directory does not exist or is not a directory: ${targetDir}`);
    return 2;
  }

  let doc;
  try {
    doc = await loadConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Config error: ${err.message}`);
      return 2;
    }
    throw err;
  }

  const result = await runChecks(doc, targetDir);
  const { text, exitCode } = renderReport(result);
  console.log(text);
  return exitCode;
}
