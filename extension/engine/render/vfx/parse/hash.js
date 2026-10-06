export function crc32(str) {
  let crc = 0xffffffff;
  const b = new TextEncoder().encode(str);
  for (let i = 0; i < b.length; i++) {
    let c = (crc ^ b[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function matPropHash(name) {
  return crc32(String(name)) & 0x0fffffff;
}
