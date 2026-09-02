import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Auto-discovers checker modules under this directory, including one level
 * (or more) of subdirectories -- e.g. method_scope/php.js. Adding a type is
 * adding a file, whether flat or nested; nesting is purely for grouping
 * per-language siblings of one checker family (see method_scope/php.js's
 * own comment on why that family is inherently per-language).
 */
async function loadRegistry() {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter(
    (e) => e.isFile() && e.name.endsWith('.js') && e.name !== 'index.js'
  );

  const registry = new Map();
  for (const entry of files) {
    const absPath = path.join(entry.parentPath ?? entry.path, entry.name);
    const mod = await import(pathToFileURL(absPath).href);
    if (!mod.type || typeof mod.check !== 'function') {
      throw new Error(`Checker module ${absPath} must export 'type' and 'check'`);
    }
    if (registry.has(mod.type)) {
      throw new Error(`Duplicate checker type '${mod.type}' (${absPath})`);
    }
    registry.set(mod.type, mod.check);
  }
  return registry;
}

let registryPromise;

export function getCheckerRegistry() {
  if (!registryPromise) registryPromise = loadRegistry();
  return registryPromise;
}
