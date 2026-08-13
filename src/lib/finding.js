/**
 * @param {object} p
 * @param {string} p.file - path relative to targetDir
 * @param {number} p.line - 1-based
 * @param {string} p.matchedText
 * @returns {{file: string, line: number, matchedText: string}}
 */
export function makeFinding({ file, line, matchedText }) {
  return { file, line, matchedText };
}
