export function extractPaths(toolInput) {
  const paths = new Set();
  visit(toolInput, '');
  return [...paths];
  function visit(value, key) {
    if (typeof value === 'string') {
      if (/^(?:file_?path|filePath|path|filename|old_?path|new_?path)$/iu.test(key) && !value.includes('\n')) paths.add(value.trim());
      for (const match of value.matchAll(/\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*([^\n]+)/giu)) paths.add(match[1].trim().replace(/^['"]|['"]$/gu, ''));
      return;
    }
    if (Array.isArray(value)) return value.forEach(item => visit(item, key === 'files' ? 'file_path' : key));
    if (value && typeof value === 'object') for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  }
}
