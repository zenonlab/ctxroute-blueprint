export function extractPaths(toolInput) {
  return extractPathEntries(toolInput).map(entry => entry.path);
}

export function extractPathEntries(toolInput) {
  const paths = new Map();
  visit(toolInput, '');
  return [...paths.values()];
  function visit(value, key) {
    if (value === String(value)) {
      if (/^(?:file_?path|filePath|path|filename|old_?path|new_?path)$/iu.test(key) && !value.includes('\n')) paths.set(value.trim(), { path: value.trim(), key });
      for (const match of value.matchAll(/\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*([^\n]+)/giu)) { const path = match[1].trim().replace(/^['"]|['"]$/gu, ''); paths.set(path, { path, key: 'patch' }); }
      return;
    }
    if (Array.isArray(value)) return value.forEach(item => visit(item, key === 'files' ? 'file_path' : key));
    if (value && value === Object(value)) for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  }
}
