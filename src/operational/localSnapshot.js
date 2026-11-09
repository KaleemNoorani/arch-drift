import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const DEMO_FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/demo-fulfillment'
);

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

/** Resolves a local fixture path without reading its contents. */
export async function resolveLocalSnapshot(input, allowedDir = DEMO_FIXTURE_DIR) {
  if (typeof input !== 'string' || !input.trim() || /^[\\/]{2}/.test(input) ||
      input.split(/[\\/]/).includes('..') ||
      /^[A-Za-z]:[^\\/]/.test(input)) {
    throw new Error('Snapshot path must be a local file in the demo fixture directory');
  }
  const root = await realpath(allowedDir);
  if (path.relative(path.resolve(allowedDir), root) !== '') {
    throw new Error('Demo fixture directory may not be a symlink or junction');
  }
  const candidate = path.resolve(input);
  if (!contained(root, candidate) || path.extname(candidate).toLowerCase() !== '.json') {
    throw new Error('Snapshot path is outside the demo fixture directory');
  }
  const relative = path.relative(root, candidate);
  let current = root;
  let finalEntry;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    finalEntry = await lstat(current);
    if (finalEntry.isSymbolicLink()) {
      throw new Error('Snapshot path may not contain a symlink or junction');
    }
  }
  if (!finalEntry.isFile()) throw new Error('Snapshot path must be a regular JSON file');
  const resolved = await realpath(candidate);
  if (!contained(root, resolved)) throw new Error('Snapshot path resolves outside the demo fixture directory');
  return resolved;
}
