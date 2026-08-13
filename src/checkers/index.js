import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

/** Auto-discovers checker modules in this directory. Adding a type = adding a file here. */
async function loadRegistry() {
  const files = (await readdir(dir)).filter(
    (f) => f.endsWith('.js') && f !== 'index.js'
  );
  const registry = new Map();
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    if (!mod.type || typeof mod.check !== 'function') {
      throw new Error(`Checker module ${file} must export 'type' and 'check'`);
    }
    if (registry.has(mod.type)) {
      throw new Error(`Duplicate checker type '${mod.type}' (${file})`);
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
