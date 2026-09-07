// Mechanical adaptation of a pinned build copy; never edit the upstream checkout.
import { readFileSync, writeFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
const directory = realpathSync(process.argv[2]);
const base = realpathSync('dist/pocs/macos-native-wallpaper');
if (!directory.startsWith(`${base}/compile.`)) throw new Error('Expected isolated build copy');
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error(`Pinned source mismatch: ${from}`);
  return text.replace(from, to);
}
for (const name of readdirSync(join(directory, 'PhospheneExtension'))) {
  if (!name.endsWith('.swift')) continue;
  const path = resolve(directory, 'PhospheneExtension', name);
  let source = readFileSync(path, 'utf8').replaceAll('glass.kagerou.phosphene', 'org.wallpaperthemes.nativeprobe');
  if (name === 'WallpaperXPCHandler.swift') {
    source = replaceOnce(source, 'let opened = NSWorkspace.shared.open(url)', 'let opened = false // Diagnostic: never launch an external application.');
  }
  if (name === 'SettingsProvider.swift') {
    source = replaceOnce(source, 'Phosphene \\u{2014} Video Wallpapers', 'Native Wallpaper Probe');
  }
  if (name === 'CallerValidation.swift') {
    if (source.split('            return true').length !== 4) throw new Error('Caller guards changed');
    source = source.replaceAll('            return true', '            return false')
      .replaceAll('accepting (fail-open)', 'rejecting (diagnostic fail-closed)');
  }
  writeFileSync(path, source);
}
