import { concat } from "../util/mem.js";
import { encode as utf8 } from "../util/utf8.js";
export function orientation(data) {
    if (data.length >= 6 && data[0] === 0x45 && data[1] === 0x78 && data[2] === 0x69 && data[3] === 0x66 && data[4] === 0 && data[5] === 0)
        data = data.subarray(6);
    if (data.length < 8)
        return 1;
    const tiff = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const little = tiff.getUint16(0) === 0x4949;
    if (!little && tiff.getUint16(0) !== 0x4d4d)
        return 1;
    const ifd = tiff.getUint32(4, little);
    if (ifd + 2 > tiff.byteLength)
        return 1;
    for (let i = 0, count = tiff.getUint16(ifd, little); i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > tiff.byteLength)
            break;
        if (tiff.getUint16(entry, little) !== 0x0112)
            continue;
        const value = tiff.getUint16(entry + 8, little);
        return value >= 1 && value <= 8 ? value : 1;
    }
    return 1;
}
export function xmpOrientation(xmp) {
    const match = /tiff:Orientation\s*(?:=\s*["']|>\s*)([1-8])\b/.exec(xmp);
    return match ? +match[1] : 1;
}
const ASCII = 2, LONG = 4, UNDEFINED = 7;
const ascii = (tag, text) => {
    const data = concat([utf8(text), [0]]);
    return { tag, type: ASCII, count: data.length, data };
};
const pad = (n) => String(n).padStart(2, '0');
export function encode(fields) {
    const ifd0 = [];
    const exifIFD = [];
    if (fields.description)
        ifd0.push(ascii(0x010e, fields.description));
    if (fields.software)
        ifd0.push(ascii(0x0131, fields.software));
    if (fields.dateTime) {
        const d = fields.dateTime;
        const time = `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
        ifd0.push(ascii(0x0132, time));
        exifIFD.push({ tag: 0x9000, type: UNDEFINED, count: 4, data: Uint8Array.of(0x30, 0x32, 0x33, 0x32) });
        exifIFD.push(ascii(0x9003, time));
        exifIFD.push(ascii(0x9010, '+00:00'));
        exifIFD.push(ascii(0x9011, '+00:00'));
    }
    if (fields.artist)
        ifd0.push(ascii(0x013b, fields.artist));
    if (fields.copyright)
        ifd0.push(ascii(0x8298, fields.copyright));
    if (exifIFD.length)
        ifd0.push({ tag: 0x8769, type: LONG, count: 1, data: new Uint8Array(4) });
    const size = (entries) => 2 + entries.length * 12 + 4 + entries.reduce((n, e) => n + (e.data.length > 4 ? e.data.length + (e.data.length & 1) : 0), 0);
    const ifd0Offset = 8;
    const exifOffset = ifd0Offset + size(ifd0);
    const out = new Uint8Array(exifOffset + (exifIFD.length ? size(exifIFD) : 0));
    const view = new DataView(out.buffer);
    out.set([0x4d, 0x4d, 0x00, 0x2a]);
    view.setUint32(4, ifd0Offset);
    const pointer = ifd0.find(e => e.tag === 0x8769);
    if (pointer)
        new DataView(pointer.data.buffer).setUint32(0, exifOffset);
    const write = (entries, offset) => {
        view.setUint16(offset, entries.length);
        let data = offset + 2 + entries.length * 12 + 4;
        entries.forEach((e, i) => {
            const at = offset + 2 + i * 12;
            view.setUint16(at, e.tag);
            view.setUint16(at + 2, e.type);
            view.setUint32(at + 4, e.count);
            if (e.data.length <= 4)
                out.set(e.data, at + 8);
            else {
                view.setUint32(at + 8, data);
                out.set(e.data, data);
                data += e.data.length + (e.data.length & 1);
            }
        });
    };
    write(ifd0, ifd0Offset);
    if (exifIFD.length)
        write(exifIFD, exifOffset);
    return out;
}
