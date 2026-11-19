import { startThreads } from "../util/threads.js";
import { MAX_PIXELS, checkPixels } from "../util/limits.js";
import { BitReader } from "./jxl/bits.js";
import { CS_GREY, CS_RGB, decodeICC, imageHeader, PRI_BT2100, PRI_CUSTOM, PRI_P3, readICC, TF_DCI, TF_HLG, TF_LINEAR, TF_PQ, WP_CUSTOM, WP_DCI, WP_E } from "./jxl/headers.js";
import { frameHeader, toc } from "./jxl/frame-header.js";
import { decodeFrame } from "./jxl/frame.js";
import { ColorOutput } from "./jxl/color.js";
import { encodeRGBA } from "./jxl/fast-lossless.js";
import { encodeModular } from "./jxl/modular-lossless.js";
import { encodeVarDCT } from "./jxl/vardct-enc.js";
import { concat } from "../util/mem.js";
import { srgbDecode } from "../util/icc.js";
import { readISO, writeISO } from "./gainmap.js";
const CONTAINER = [0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a];
export function isJXL(d) {
    if (d.length >= 2 && d[0] === 0xff && d[1] === 0x0a)
        return true;
    return d.length >= 12 && CONTAINER.every((v, i) => d[i] === v);
}
export async function encode(rgba, width, height, exif, distance = 0, effort = 1, threads = 1, gainMap) {
    const codestreamOf = (pixels, w, h, d) => d > 0 ? encodeVarDCT(pixels, w, h, { distance: d, effort, threads })
        : effort ? encodeModular(pixels, w, h, threads) : encodeRGBA(pixels, w, h);
    const stream = await codestreamOf(rgba, width, height, distance);
    if (!exif?.length && !gainMap)
        return stream;
    const jxl = [0x6a, 0x78, 0x6c, 0x20];
    const boxes = [...box('ftyp', jxl, [0, 0, 0, 0], jxl)];
    if (exif?.length)
        boxes.push(...box('Exif', [0, 0, 0, 0], exif));
    if (gainMap) {
        const metadata = writeISO(gainMap.params);
        const map = await codestreamOf(gainMap.pixels, gainMap.width, gainMap.height, gainMap.distance);
        boxes.push(...box('jhgm', [0, metadata.length >> 8, metadata.length & 255], metadata, [0, 0, 0, 0, 0], map));
    }
    return concat([CONTAINER, ...boxes, ...box('jxlc', stream)]);
}
const box = (type, ...content) => {
    const size = 8 + content.reduce((n, c) => n + c.length, 0);
    return [[size >>> 24, size >> 16 & 255, size >> 8 & 255, size & 255, ...Array.from(type, c => c.charCodeAt(0))], ...content];
};
const fourcc = (d, o) => String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
function* boxesOf(d) {
    const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
    for (let o = 0; o + 8 <= d.length;) {
        let size = view.getUint32(o), header = 8;
        const type = fourcc(d, o + 4);
        if (size === 1) {
            if (o + 16 > d.length)
                throw new Error('JPEG XL: truncated box');
            size = view.getUint32(o + 8) * 2 ** 32 + view.getUint32(o + 12);
            header = 16;
        }
        else if (size === 0)
            size = d.length - o;
        if (size < header || o + size > d.length)
            throw new Error(`JPEG XL: invalid ${type} box`);
        yield { type, content: d.subarray(o + header, o + size) };
        o += size;
    }
}
function codestream(d) {
    if (d[0] === 0xff)
        return d;
    const parts = [];
    for (const { type, content } of boxesOf(d)) {
        if (type === 'jxlc')
            return content;
        if (type === 'jxlp')
            parts.push(content.subarray(4));
    }
    if (!parts.length)
        throw new Error('JPEG XL: no codestream');
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
const WHITE_D65 = [0.3127, 0.3290];
const PRIMARIES = {
    [PRI_BT2100]: [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]],
    [PRI_P3]: [[0.680, 0.320], [0.265, 0.690], [0.150, 0.060]],
};
export function colorSpace(image) {
    const c = image.colour;
    if (image.xybEncoded || c.wantICC || (c.colourSpace !== CS_RGB && c.colourSpace !== CS_GREY))
        return;
    if (c.transfer === TF_PQ || c.transfer === TF_HLG)
        return;
    const curve = c.transfer === -1 ? (c.gamma > 0 ? v => v ** (1 / c.gamma) : null)
        : c.transfer === TF_LINEAR ? v => v : c.transfer === TF_DCI ? v => v ** 2.6 : null;
    const white = c.whitePoint === WP_CUSTOM ? c.white : c.whitePoint === WP_E ? [1 / 3, 1 / 3] : c.whitePoint === WP_DCI ? [0.314, 0.351] : null;
    const primaries = c.colourSpace === CS_GREY ? null : c.primaries === PRI_CUSTOM
        ? [0, 2, 4].map(i => c.primariesXY.slice(i, i + 2)) : PRIMARIES[c.primaries] ?? null;
    if (c.colourSpace === CS_GREY)
        return curve ? { xy: null, curve } : undefined;
    if (!curve && !white && !primaries)
        return;
    return { xy: [...primaries ?? [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]], white ?? WHITE_D65], curve: curve ?? srgbDecode };
}
export async function* frames(data, maxPixels = MAX_PIXELS, toneMapping = 'reinhard', threads = 1) {
    const d = codestream(data);
    const r = new BitReader(d);
    const image = imageHeader(r);
    checkPixels(image.width, image.height, maxPixels);
    const stream = image.colour.wantICC ? readICC(r) : null;
    const icc = stream && !image.xybEncoded ? decodeICC(stream) ?? undefined : undefined;
    const space = icc ? undefined : colorSpace(image);
    r.zeroPadToByte();
    let at = r.bytePosition;
    if (image.preview) {
        const pr = new BitReader(d, at);
        at = toc(pr, frameHeader(pr, { ...image, ...image.preview })).end;
    }
    const state = {
        image, output: new ColorOutput(image, toneMapping), references: [null, null, null, null], referenceIsXYB: [false, false, false, false],
        lfFrames: [null, null, null, null], visible: 0, invisible: 0
    };
    const a = image.animation, tick = a ? 1000 * a.tpsDenominator / a.tpsNumerator : 0;
    const pixels = image.width * image.height;
    const n = Math.min(threads, image.xybEncoded ? Math.floor(pixels / (2 << 20)) : pixels >= 1536 << 10 && d.length >= 512 << 10 ? Math.floor(pixels / (512 << 10)) : 1);
    const pool = { threads: n > 1 ? startThreads(n) : null, data: null };
    try {
        let shown = 0;
        for (;;) {
            if (at >= d.length) {
                if (shown)
                    return;
                throw new Error('JPEG XL: no frame shown');
            }
            const frame = await decodeFrame(d, new BitReader(d, at), state, at, pool);
            at = frame.end;
            if (frame.canvas && (frame.header.isLast || frame.header.duration !== 0)) {
                shown++;
                yield {
                    width: image.width, height: image.height, pixels: state.output.toRGBA(frame.canvas), duration: frame.header.duration * tick,
                    orientation: image.orientation, loopCount: a ? a.numLoops : 1, icc, colorSpace: space
                };
            }
            if (frame.header.isLast)
                return;
        }
    }
    finally {
        if (pool.threads)
            for (const t of pool.threads)
                t.terminate();
    }
}
export async function decode(data, maxPixels = MAX_PIXELS, toneMapping = 'reinhard', threads = 1, gainMap = false) {
    for await (const frame of frames(data, maxPixels, toneMapping, threads)) {
        if (!gainMap || data[0] === 0xff)
            return frame;
        return { ...frame, gainMap: await decodeGainMap(data, maxPixels).catch(() => undefined) };
    }
    throw new Error('JPEG XL: no frame shown');
}
export async function decodeGainMap(data, maxPixels) {
    for (const { type, content: c } of boxesOf(data)) {
        if (type !== 'jhgm')
            continue;
        if (c.length < 3 || c[0] !== 0)
            return undefined;
        const metadataSize = c[1] << 8 | c[2];
        let o = 3 + metadataSize;
        if (o + 1 > c.length)
            return undefined;
        const metadata = c.subarray(3, o);
        const params = readISO(metadata) ?? (metadata[0] === 0 ? readISO(metadata.subarray(1)) : null);
        o += 1 + c[o];
        if (!params || o + 4 > c.length)
            return undefined;
        o += 4 + (c[o] << 24 >>> 0) + (c[o + 1] << 16 | c[o + 2] << 8 | c[o + 3]);
        if (o >= c.length)
            return undefined;
        for await (const { width, height, pixels } of frames(c.subarray(o), maxPixels, 'clamp', 1))
            return { width, height, pixels, params };
    }
    return undefined;
}
