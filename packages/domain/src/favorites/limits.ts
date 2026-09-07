export const favoriteObservationByteLimit = 64 * 1024;
export const favoriteParseArtifactByteLimit = 64 * 1024;
export const favoriteTitleByteLimit = 8 * 1024;
export const favoriteUrlByteLimit = 32 * 1024;
export const favoriteFolderSegmentLimit = 32;
export const favoriteFolderSegmentByteLimit = 512;
export const favoriteEvidenceLimit = 32;
export const favoriteAliasLimit = 16;
export const favoriteTransformationLimit = 64;
export const favoriteDiagnosticLimit = 32;
export const providerCandidateLimit = 20;

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}
