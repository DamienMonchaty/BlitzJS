/** Result of compiling a route pattern */
export interface CompiledPattern {
  regex: RegExp;
  paramNames: string[];
  isStatic: boolean;
}

/**
 * Compile a route pattern with ultra-fast optimization detection
 *
 * Determines if route is static (no parameters) for O(1) HashMap lookup,
 * or dynamic requiring regex matching with parameter extraction.
 */
export function compilePattern(pattern: string): CompiledPattern {
  const paramNames: string[] = [];
  const isStatic = !pattern.includes(':') && !pattern.includes('*');

  if (isStatic) {
    // Static route - no need for expensive regex
    return {
      regex: new RegExp(''), // Dummy regex, won't be used for static routes
      paramNames: [],
      isStatic: true
    };
  }

  // Dynamic route - ultra-optimized regex
  const regexPattern = pattern
    .replace(/:([^/]+)/g, (_match, paramName) => {
      paramNames.push(paramName);
      return '([^/]+)';
    })
    .replace(/\*/g, '.*')
    .replace(/\//g, '\\/'); // Escape slashes AFTER processing params

  const regex = new RegExp(`^${regexPattern}$`);

  return { regex, paramNames, isStatic: false };
}
