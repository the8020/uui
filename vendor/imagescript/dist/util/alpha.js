export let littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
export function useLittleEndian(value) {
    littleEndian = value;
}
const words = (bitmap) => new Int32Array(bitmap.buffer, bitmap.byteOffset, bitmap.length >> 2);
export function isOpaque(bitmap) {
    const pixels = words(bitmap);
    let all = -1;
    for (let i = 0; i < pixels.length; i++)
        all &= pixels[i];
    return all >>> 24 === 255;
}
export function premultiply8(bitmap, out) {
    const src = words(bitmap), dst = words(out);
    for (let i = 0; i < src.length; i++) {
        const p = src[i], a = p >>> 24;
        if (a === 255) {
            dst[i] = p;
            continue;
        }
        let rb = Math.imul(p & 0xff00ff, a) + 0x800080;
        rb = (rb + (rb >>> 8 & 0xff00ff)) >>> 8 & 0xff00ff;
        const g = (p >> 8 & 255) * a + 128;
        dst[i] = rb | (g + (g >> 8) & 0xff00) | a << 24;
    }
}
let unpremultiplied;
export function unpremultiply8(bitmap) {
    if (!unpremultiplied) {
        unpremultiplied = new Uint8ClampedArray(65536);
        for (let i = 256; i < 65536; i++)
            unpremultiplied[i] = (i & 255) * (255 / (i >> 8));
    }
    const table = unpremultiplied, pixels = words(bitmap);
    for (let i = 0; i < pixels.length; i++) {
        const p = pixels[i], a = p >>> 24;
        if (a === 255)
            continue;
        if (a === 0) {
            pixels[i] = 0;
            continue;
        }
        const o = a << 8;
        pixels[i] = table[o | p & 255] | table[o | p >> 8 & 255] << 8 | table[o | p >> 16 & 255] << 16 | a << 24;
    }
}
