import path from 'path';

// Define the project root as the current working directory at process start.
// All file operations for tools should be constrained to this root.
export const PROJECT_ROOT = process.cwd();

/**
 * Resolve a user-supplied path against the project root and ensure it does not escape
 * the workspace. Throws an error if the resolved path is outside PROJECT_ROOT.
 */
export function resolveProjectPath(relativeOrAbsolute: string): string {
  if (!relativeOrAbsolute || typeof relativeOrAbsolute !== 'string') {
    throw new Error('Path is required');
  }

  const resolved = path.resolve(PROJECT_ROOT, relativeOrAbsolute);

  // Ensure the resolved path is within the project root
  const normalizedRoot = path.resolve(PROJECT_ROOT) + path.sep;
  const normalizedResolved = resolved.endsWith(path.sep)
    ? resolved
    : resolved + '';

  if (!normalizedResolved.startsWith(normalizedRoot) && normalizedResolved !== PROJECT_ROOT) {
    throw new Error('Access outside project root is not allowed');
  }

  return resolved;
}

