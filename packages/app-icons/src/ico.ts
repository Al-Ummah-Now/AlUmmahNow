// Minimal ICO writer: PNG-compressed entries (supported by every browser and by Windows Vista+).

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 24 || sig.some((b, i) => png[i] !== b)) throw new Error('not a PNG');
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

/** One .ico holding the given PNGs, smallest first. */
export function ico(pngs: Uint8Array[]): Uint8Array {
  const header = 6, entry = 16;
  const total = header + entry * pngs.length + pngs.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, true); // reserved
  v.setUint16(2, 1, true); // type: icon
  v.setUint16(4, pngs.length, true);
  let offset = header + entry * pngs.length;
  pngs.forEach((png, i) => {
    const { width, height } = pngSize(png);
    if (width > 256 || height > 256) throw new Error('ICO entries are at most 256 px');
    const at = header + entry * i;
    v.setUint8(at, width === 256 ? 0 : width);
    v.setUint8(at + 1, height === 256 ? 0 : height);
    v.setUint8(at + 2, 0); // palette colours
    v.setUint8(at + 3, 0); // reserved
    v.setUint16(at + 4, 1, true); // colour planes
    v.setUint16(at + 6, 32, true); // bits per pixel
    v.setUint32(at + 8, png.length, true);
    v.setUint32(at + 12, offset, true);
    out.set(png, offset);
    offset += png.length;
  });
  return out;
}
