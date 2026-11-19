import { MAX_PIXELS } from "../util/limits.js";
import { decodeDIB } from "./bmp.js";
const u16 = (d, o) => d[o] | d[o + 1] << 8;
const u32 = (d, o) => (d[o] | d[o + 1] << 8 | d[o + 2] << 16 | d[o + 3] << 24) >>> 0;
const isPNG = (d, o) => d[o] === 0x89 && d[o + 1] === 0x50 && d[o + 2] === 0x4e && d[o + 3] === 0x47;
export function iconType(d) {
    if (d.length < 22 || u16(d, 0) !== 0 || (u16(d, 2) !== 1 && u16(d, 2) !== 2))
        return null;
    const count = u16(d, 4);
    if (!count || d.length < 6 + count * 16 || d[9] !== 0)
        return null;
    const offset = u32(d, 18);
    if (offset < 6 + count * 16 || offset + 24 > d.length)
        return null;
    return isPNG(d, offset) || [12, 40, 52, 56, 108, 124].includes(u32(d, offset)) ? u16(d, 2) === 1 ? 'ico' : 'cur' : null;
}
export function decode(d, maxPixels = MAX_PIXELS) {
    if (!iconType(d))
        throw new Error('ICO: invalid header');
    let best = null;
    for (let i = 0, count = u16(d, 4); i < count; i++) {
        const e = 6 + i * 16;
        const offset = u32(d, e + 12);
        let size = u32(d, e + 8);
        if (offset + 24 > d.length)
            continue;
        if (size < 16 || offset + size > d.length)
            size = d.length - offset;
        let area, bits;
        if (isPNG(d, offset)) {
            const view = new DataView(d.buffer, d.byteOffset + offset);
            area = view.getUint32(16) * view.getUint32(20);
            bits = 32;
        }
        else {
            area = Math.abs(u32(d, offset + 4) * (u32(d, offset + 8) >> 1));
            bits = u16(d, offset + 14);
        }
        if (!best || area > best.area || area === best.area && bits > best.bits)
            best = { offset, size, area, bits };
    }
    if (!best)
        throw new Error('ICO: no image inside the data');
    const data = d.subarray(best.offset, best.offset + best.size);
    if (isPNG(data, 0))
        return { embedded: 'png', data };
    return decodeDIB(data, 0, null, maxPixels, true);
}
