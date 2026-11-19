// Generates simple PNG app icons (no external tools) – run: node scripts/gen-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // martini glass: triangle 0.25..0.75 top (0.25-0.5), stem, base
      const inTri = v > 0.25 && v < 0.5 && Math.abs(u - 0.5) < (0.5 - v) * 1.0;
      const inStem = v >= 0.48 && v < 0.72 && Math.abs(u - 0.5) < 0.03;
      const inBase = v >= 0.72 && v < 0.77 && Math.abs(u - 0.5) < 0.15;
      const col = inTri || inStem || inBase ? [245, 158, 11] : [17, 24, 39];
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = col[0]; raw[i + 1] = col[1]; raw[i + 2] = col[2]; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [192, 512]) fs.writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), png(s));
console.log('icons written');
