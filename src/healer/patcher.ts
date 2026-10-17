/**
 * Replace exactly one locator expression in a test file with ts-morph.
 *
 * Only the call-expression node of the locator is touched. Assertions,
 * expected values, comments and formatting stay byte-for-byte identical,
 * which the patcher verifies before writing the file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Project, SyntaxKind } from 'ts-morph';
import { isLocatorChain, normaliseLocatorText } from './locator-expression.js';

export interface PatchRequest {
  filePath: string;
  /** A line covered by the statement that contains the locator. */
  line: number;
  oldLocator: string;
  newLocator: string;
}

export interface PatchResult {
  filePath: string;
  line: number;
  oldLocator: string;
  newLocator: string;
  /** Character offsets of the replaced range in the original file. */
  start: number;
  end: number;
}

export class PatchError extends Error {
  override name = 'PatchError';
}

const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
let counter = 0;

export function patchLocator(request: PatchRequest): PatchResult {
  const before = readFileSync(request.filePath, 'utf8');
  const oldText = normaliseLocatorText(request.oldLocator);
  const newText = normaliseLocatorText(request.newLocator);
  if (oldText === newText) throw new PatchError('old and new locator are identical');

  const file = project.createSourceFile(`__patch_${counter++}.ts`, before, { overwrite: true });
  try {
    // Descendants come in document order, so the first match is the outermost
    // call expression: the whole chain, not an inner `page.locator(...)`.
    const node = file.getDescendantsOfKind(SyntaxKind.CallExpression).find(
      (call) =>
        call.getStartLineNumber() <= request.line &&
        call.getEndLineNumber() >= request.line &&
        isLocatorChain(call) &&
        normaliseLocatorText(call.getText()) === oldText,
    );
    if (!node) {
      throw new PatchError(`locator ${oldText} not found on line ${request.line} of ${request.filePath}`);
    }
    const start = node.getStart();
    const end = node.getEnd();
    node.replaceWithText(newText);
    const after = file.getFullText();

    const expected = before.slice(0, start) + newText + before.slice(end);
    if (after !== expected) {
      throw new PatchError('ts-morph changed more than the locator expression; refusing to write');
    }
    writeFileSync(request.filePath, after, 'utf8');
    return { filePath: request.filePath, line: request.line, oldLocator: oldText, newLocator: newText, start, end };
  } finally {
    project.removeSourceFile(file);
  }
}

/** Undo a patch by swapping the new locator back for the old one. */
export function revertPatch(patch: PatchResult): PatchResult {
  return patchLocator({
    filePath: patch.filePath,
    line: patch.line,
    oldLocator: patch.newLocator,
    newLocator: patch.oldLocator,
  });
}
