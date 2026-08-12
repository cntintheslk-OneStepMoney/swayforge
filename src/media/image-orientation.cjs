'use strict';

const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const EXIF_PREFIX = Buffer.from('Exif\0\0', 'binary');
const ORIENTATION_TAG = 0x0112;
const TIFF_SHORT = 3;

function readUInt16(buffer, offset, littleEndian) {
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function readUInt32(buffer, offset, littleEndian) {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function exifOrientationFromApp1(payload) {
  if (payload.length < 14 || !payload.subarray(0, EXIF_PREFIX.length).equals(EXIF_PREFIX)) return 1;
  const tiff = EXIF_PREFIX.length;
  const byteOrder = payload.toString('ascii', tiff, tiff + 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') return 1;
  if (tiff + 8 > payload.length || readUInt16(payload, tiff + 2, littleEndian) !== 42) return 1;
  const ifdOffset = readUInt32(payload, tiff + 4, littleEndian);
  const ifd = tiff + ifdOffset;
  if (ifd < tiff || ifd + 2 > payload.length) return 1;
  const entries = readUInt16(payload, ifd, littleEndian);
  if (!Number.isSafeInteger(entries) || entries > 4096) return 1;

  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + (index * 12);
    if (entry + 12 > payload.length) return 1;
    const tag = readUInt16(payload, entry, littleEndian);
    if (tag !== ORIENTATION_TAG) continue;
    const type = readUInt16(payload, entry + 2, littleEndian);
    const count = readUInt32(payload, entry + 4, littleEndian);
    if (type !== TIFF_SHORT || count !== 1) return 1;
    const orientation = readUInt16(payload, entry + 8, littleEndian);
    return orientation >= 1 && orientation <= 8 ? orientation : 1;
  }
  return 1;
}

function readExifOrientation(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || !buffer.subarray(0, 2).equals(JPEG_SOI)) return 1;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset++];
    if (marker === 0xd8 || marker === 0x01) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if (marker === 0xe1) {
      const payload = buffer.subarray(offset + 2, offset + length);
      const orientation = exifOrientationFromApp1(payload);
      if (orientation !== 1 || payload.subarray(0, EXIF_PREFIX.length).equals(EXIF_PREFIX)) return orientation;
    }
    offset += length;
  }
  return 1;
}

function orientedDimensions(width, height, orientation) {
  if (![5, 6, 7, 8].includes(orientation)) return { width, height };
  return { width: height, height: width };
}

function targetCoordinate(x, y, width, height, orientation) {
  switch (orientation) {
    case 2: return { x: width - 1 - x, y };
    case 3: return { x: width - 1 - x, y: height - 1 - y };
    case 4: return { x, y: height - 1 - y };
    case 5: return { x: y, y: x };
    case 6: return { x: height - 1 - y, y: x };
    case 7: return { x: height - 1 - y, y: width - 1 - x };
    case 8: return { x: y, y: width - 1 - x };
    default: return { x, y };
  }
}

function orientBitmap(bitmap, width, height, orientation = 1) {
  if (!Buffer.isBuffer(bitmap)) throw new TypeError('bitmap must be a Buffer.');
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new TypeError('bitmap dimensions are invalid.');
  }
  if (!Number.isSafeInteger(orientation) || orientation < 1 || orientation > 8) {
    throw new TypeError('EXIF orientation is invalid.');
  }
  const expectedBytes = width * height * 4;
  if (!Number.isSafeInteger(expectedBytes) || bitmap.length !== expectedBytes) {
    throw new TypeError('bitmap length does not match dimensions.');
  }
  if (orientation === 1) return { bitmap: Buffer.from(bitmap), width, height };

  const dimensions = orientedDimensions(width, height, orientation);
  const output = Buffer.allocUnsafe(bitmap.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = ((y * width) + x) * 4;
      const target = targetCoordinate(x, y, width, height, orientation);
      const targetOffset = ((target.y * dimensions.width) + target.x) * 4;
      bitmap.copy(output, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return { bitmap: output, ...dimensions };
}

module.exports = {
  ORIENTATION_TAG,
  exifOrientationFromApp1,
  orientBitmap,
  orientedDimensions,
  readExifOrientation,
  targetCoordinate
};
