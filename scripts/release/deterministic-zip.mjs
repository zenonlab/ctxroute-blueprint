import { deflateRawSync } from 'node:zlib';

const utf8Flag = 0x0800;
const method = 8;
const fixedDosDate = ((2020 - 1980) << 9) | (1 << 5) | 1;
const fixedDosTime = 0;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(input) {
  let crc = 0xffffffff;
  for (const byte of input) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(entry, offset) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(utf8Flag, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(fixedDosTime, 10);
  header.writeUInt16LE(fixedDosDate, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressed.length, 18);
  header.writeUInt32LE(entry.content.length, 22);
  header.writeUInt16LE(entry.name.length, 26);
  return { buffers: [header, entry.name, entry.compressed], offset };
}

function centralHeader(entry, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(utf8Flag, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(fixedDosTime, 12);
  header.writeUInt16LE(fixedDosDate, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.content.length, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, entry.name]);
}

export function createDeterministicZip(entries) {
  const normalized = entries
    .map(({ content, name }) => {
      const normalizedName = name.replaceAll('\\', '/');
      if (!normalizedName || normalizedName.startsWith('/') || normalizedName.split('/').includes('..')) {
        throw new Error(`Unsafe ZIP entry name: ${name}`);
      }
      return { content: Buffer.from(content), name: Buffer.from(normalizedName) };
    })
    .sort((left, right) => left.name.compare(right.name))
    .map((entry) => ({ ...entry, compressed: deflateRawSync(entry.content, { level: 9 }), crc: crc32(entry.content) }));
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of normalized) {
    const local = localHeader(entry, localOffset);
    localParts.push(...local.buffers);
    centralParts.push(centralHeader(entry, localOffset));
    localOffset += local.buffers.reduce((total, buffer) => total + buffer.length, 0);
  }

  const centralSize = centralParts.reduce((total, buffer) => total + buffer.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(normalized.length, 8);
  end.writeUInt16LE(normalized.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

export function selectRollbackArtifact(history, currentVersion) {
  const candidate = [...history].reverse().find((entry) => entry.version !== currentVersion);
  if (!candidate?.artifact || !candidate.sha256) throw new Error('No verified previous artifact is available.');
  return candidate;
}
