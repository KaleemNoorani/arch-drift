import { readFile } from 'node:fs/promises';

/** Reads a file and returns its lines (no trailing newline chars). */
export async function readLines(absPath) {
  const content = await readFile(absPath, 'utf8');
  return content.split(/\r\n|\r|\n/);
}

/** Returns {line, index} for the 1-based line number containing charIndex in `content`. */
export function lineAt(content, charIndex) {
  let line = 1;
  for (let i = 0; i < charIndex && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}
