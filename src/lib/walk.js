import { readdir } from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';

/**
 * Walks targetDir recursively and returns POSIX-style relative paths
 * matching any of `scope` globs and none of `except` globs.
 */
export async function findFiles(targetDir, scope, except = []) {
  const entries = await readdir(targetDir, { recursive: true, withFileTypes: true });
  const isScoped = picomatch(scope);
  const isExcepted = except.length ? picomatch(except) : () => false;

  const relFiles = entries
    .filter((e) => e.isFile())
    .map((e) => {
      const abs = path.join(e.parentPath ?? e.path, e.name);
      return path.relative(targetDir, abs).split(path.sep).join('/');
    });

  return relFiles.filter((rel) => isScoped(rel) && !isExcepted(rel));
}
