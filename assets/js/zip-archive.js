const localHeaderSignature = 0x04034b50;
const centralHeaderSignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const zipVersion = 20;
const utf8NamesFlag = 0x0800;
const storedMethod = 0;
const localHeaderLength = 30;
const centralHeaderLength = 46;
const endOfCentralDirectoryLength = 22;
const maximumEntries = 0xffff;
const crcTable = buildCrcTable();

export class ZipLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZipLimitError";
  }
}

export async function buildZip(files) {
  guardEntryCount(files);
  const encoder = new TextEncoder();
  const timestamp = toDosTimestamp(new Date());
  const bodyParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const buffer = await file.blob.arrayBuffer();
    const data = new Uint8Array(buffer);
    const record = { nameBytes, data, checksum: crc32(data), timestamp, offset };
    const localHeader = writeLocalHeader(record);
    const centralHeader = writeCentralHeader(record);
    bodyParts.push(localHeader, nameBytes, data);
    centralParts.push(centralHeader, nameBytes);
    offset += localHeaderLength + nameBytes.length + data.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0);
  const end = writeEndOfCentralDirectory(files.length, centralSize, offset);
  return new Blob([...bodyParts, ...centralParts, end], { type: "application/zip" });
}

function guardEntryCount(files) {
  if (files.length > maximumEntries) throw new ZipLimitError(`A ZIP holds at most ${maximumEntries} files; ${files.length} were requested.`);
}

function writeLocalHeader(record) {
  const header = new DataView(new ArrayBuffer(localHeaderLength));
  header.setUint32(0, localHeaderSignature, true);
  header.setUint16(4, zipVersion, true);
  header.setUint16(6, utf8NamesFlag, true);
  header.setUint16(8, storedMethod, true);
  header.setUint16(10, record.timestamp.time, true);
  header.setUint16(12, record.timestamp.date, true);
  header.setUint32(14, record.checksum, true);
  header.setUint32(18, record.data.length, true);
  header.setUint32(22, record.data.length, true);
  header.setUint16(26, record.nameBytes.length, true);
  header.setUint16(28, 0, true);
  return header;
}

function writeCentralHeader(record) {
  const header = new DataView(new ArrayBuffer(centralHeaderLength));
  header.setUint32(0, centralHeaderSignature, true);
  header.setUint16(4, zipVersion, true);
  header.setUint16(6, zipVersion, true);
  header.setUint16(8, utf8NamesFlag, true);
  header.setUint16(10, storedMethod, true);
  header.setUint16(12, record.timestamp.time, true);
  header.setUint16(14, record.timestamp.date, true);
  header.setUint32(16, record.checksum, true);
  header.setUint32(20, record.data.length, true);
  header.setUint32(24, record.data.length, true);
  header.setUint16(28, record.nameBytes.length, true);
  header.setUint16(30, 0, true);
  header.setUint16(32, 0, true);
  header.setUint16(34, 0, true);
  header.setUint16(36, 0, true);
  header.setUint32(38, 0, true);
  header.setUint32(42, record.offset, true);
  return header;
}

function writeEndOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const end = new DataView(new ArrayBuffer(endOfCentralDirectoryLength));
  end.setUint32(0, endOfCentralDirectorySignature, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entryCount, true);
  end.setUint16(10, entryCount, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralOffset, true);
  end.setUint16(20, 0, true);
  return end;
}

function toDosTimestamp(moment) {
  const time = (moment.getHours() << 11) | (moment.getMinutes() << 5) | Math.floor(moment.getSeconds() / 2);
  const date = ((moment.getFullYear() - 1980) << 9) | ((moment.getMonth() + 1) << 5) | moment.getDate();
  return { time, date };
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
