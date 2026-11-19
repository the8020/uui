/*!
 * WebP container. Animation frames are blended with libwebp's integer arithmetic (Copyright (c) 2010 Google Inc., BSD
 * license, see THIRD_PARTY_NOTICES.md)
 */
import * as vp8l from "./vp8l.js";
import * as vp8 from "./vp8.js";
import { encodeVP8, encodeAlpha } from "./vp8-enc.js";
import { rgbaToYUV } from "./vp8-enc-dsp.js";
import { orientation as exifOrientation } from "./exif.js";
import { MAX_PIXELS, checkPixels } from "../util/limits.js";
import { effort as checkEffort, quality as checkQuality } from "../util/options.js";
import { startThreads } from "../util/threads.js";
const fourCC = (s) => s.charCodeAt(0) | s.charCodeAt(1) << 8 | s.charCodeAt(2) << 16 | s.charCodeAt(3) << 24;
const RIFF = fourCC('RIFF'), WEBP = fourCC('WEBP');
const VP8 = fourCC('VP8 '), VP8L = fourCC('VP8L'), VP8X = fourCC('VP8X');
const ALPH = fourCC('ALPH'), ANIM = fourCC('ANIM'), ANMF = fourCC('ANMF'), EXIF = fourCC('EXIF'), ICCP = fourCC('ICCP');
function chunks(data, start, end) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const out = [];
    let offset = start;
    while (offset + 8 <= end) {
        const type = view.getUint32(offset, true);
        const size = view.getUint32(offset + 4, true);
        const dataStart = offset + 8;
        out.push({ type, data: data.subarray(dataStart, Math.min(end, dataStart + size)) });
        offset = dataStart + size + (size & 1);
    }
    return out;
}
function container(data) {
    if (data.length < 12)
        throw new Error('WebP: invalid header');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(0, true) !== RIFF || view.getUint32(8, true) !== WEBP)
        throw new Error('WebP: invalid header');
    const size = view.getUint32(4, true);
    return chunks(data, 12, Math.min(data.length, 8 + size));
}
const u24 = (d, o) => d[o] | d[o + 1] << 8 | d[o + 2] << 16;
function decodeBitstream(list, maxPixels) {
    let alpha = null;
    for (const chunk of list) {
        if (chunk.type === ALPH)
            alpha ??= chunk;
        else if (chunk.type === VP8L) {
            const { width, height, argb } = vp8l.decode(chunk.data, maxPixels);
            const pixels = new Uint8Array(width * height * 4);
            const out = new DataView(pixels.buffer);
            for (let i = 0; i < argb.length; i++) {
                const p = argb[i];
                out.setUint32(i * 4, (p << 8 | p >>> 24) >>> 0);
            }
            return { width, height, pixels };
        }
        else if (chunk.type === VP8) {
            const image = vp8.decode(chunk.data, maxPixels);
            if (alpha)
                applyAlpha(image.pixels, image.width, image.height, alpha.data);
            return image;
        }
    }
    throw new Error('WebP: no image data');
}
function applyAlpha(rgba, width, height, chunk) {
    if (!chunk.length)
        return;
    const header = chunk[0];
    const compression = header & 3, filter = header >> 2 & 3;
    const total = width * height;
    let alpha;
    if (compression === 0) {
        alpha = new Uint8Array(total);
        alpha.set(chunk.subarray(1, 1 + total));
    }
    else if (compression === 1) {
        const argb = vp8l.decodeStream(new vp8l.BitReader(chunk, 1), width, height);
        alpha = new Uint8Array(total);
        for (let i = 0; i < total; i++)
            alpha[i] = argb[i] >> 8 & 255;
    }
    else
        throw new Error('WebP: invalid alpha compression');
    if (filter)
        unfilterAlpha(alpha, width, height, filter);
    for (let i = 0; i < total; i++)
        rgba[i * 4 + 3] = alpha[i];
}
function unfilterAlpha(a, width, height, filter) {
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            const i = row + x;
            let prediction;
            if (x === 0 && y === 0)
                prediction = 0;
            else if (y === 0)
                prediction = a[i - 1];
            else if (x === 0)
                prediction = a[i - width];
            else if (filter === 1)
                prediction = a[i - 1];
            else if (filter === 2)
                prediction = a[i - width];
            else {
                const g = a[i - 1] + a[i - width] - a[i - width - 1];
                prediction = g < 0 ? 0 : g > 255 ? 255 : g;
            }
            a[i] = a[i] + prediction & 255;
        }
    }
}
export function isAnimated(data) {
    const list = container(data);
    const header = list[0];
    return header && header.type === VP8X && header.data.length >= 10 && (header.data[0] & 2) !== 0 && list.some(c => c.type === ANMF);
}
export function decode(data, maxPixels = MAX_PIXELS) {
    const list = container(data);
    if (!list.length)
        throw new Error('WebP: no image data');
    const icc = list.find(c => c.type === ICCP)?.data;
    let orientation = 1;
    const exif = list.find(c => c.type === EXIF);
    if (exif)
        orientation = exifOrientation(exif.data);
    if (list.some(c => c.type === ANMF)) {
        const animation = decodeAnimation(data, true, maxPixels);
        const frame = composite(animation)[0];
        return { width: animation.width, height: animation.height, pixels: frame.pixels, orientation, icc };
    }
    const image = decodeBitstream(list, maxPixels);
    if (list[0].type === VP8X && list[0].data.length >= 10) {
        const width = u24(list[0].data, 4) + 1, height = u24(list[0].data, 7) + 1;
        if (width !== image.width || height !== image.height)
            throw new Error('WebP: canvas and image sizes differ');
    }
    return { ...image, orientation, icc };
}
export function decodeAnimation(data, onlyFirstFrame = false, maxPixels = MAX_PIXELS) {
    const list = container(data);
    const header = list[0];
    if (!header || header.type !== VP8X || !list.some(c => c.type === ANMF)) {
        const { width, height, pixels } = decodeBitstream(list, maxPixels);
        return { width, height, loopCount: 0, background: 0, frames: [{ x: 0, y: 0, width, height, duration: 0, blend: false, dispose: false, pixels }], icc: list.find(c => c.type === ICCP)?.data, orientation: orientationOf(list) };
    }
    if (header.data.length < 10)
        throw new Error('WebP: invalid VP8X chunk');
    const width = u24(header.data, 4) + 1, height = u24(header.data, 7) + 1;
    checkPixels(width, height, maxPixels, onlyFirstFrame ? 1 : list.filter(c => c.type === ANMF).length);
    let loopCount = 0, background = 0;
    const frames = [];
    for (const chunk of list) {
        if (chunk.type === ANIM && chunk.data.length >= 6) {
            const d = chunk.data;
            background = (d[3] << 24 | d[2] << 16 | d[1] << 8 | d[0]) >>> 0;
            loopCount = d[4] | d[5] << 8;
        }
        else if (chunk.type === ANMF) {
            const d = chunk.data;
            if (d.length < 16)
                throw new Error('WebP: invalid ANMF chunk');
            const frame = decodeBitstream(chunks(d, 16, d.length), maxPixels);
            frames.push({
                x: u24(d, 0) * 2,
                y: u24(d, 3) * 2,
                width: frame.width,
                height: frame.height,
                duration: u24(d, 12),
                blend: (d[15] & 2) === 0,
                dispose: (d[15] & 1) === 1,
                pixels: frame.pixels
            });
            if (onlyFirstFrame)
                break;
        }
    }
    if (!frames.length)
        throw new Error('WebP: animation without frames');
    return { width, height, loopCount, background, frames, icc: list.find(c => c.type === ICCP)?.data, orientation: orientationOf(list) };
}
function orientationOf(list) {
    const exif = list.find(c => c.type === EXIF);
    return exif ? exifOrientation(exif.data) : 1;
}
export function composite({ width, height, frames }) {
    const canvas = new Uint8Array(width * height * 4);
    const output = [];
    for (const frame of frames) {
        const x0 = Math.min(frame.x, width), x1 = Math.min(frame.x + frame.width, width);
        const y0 = Math.min(frame.y, height), y1 = Math.min(frame.y + frame.height, height);
        for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
                const s = ((y - frame.y) * frame.width + x - frame.x) * 4, d = (y * width + x) * 4;
                const sa = frame.pixels[s + 3];
                if (!frame.blend || sa === 255 || canvas[d + 3] === 0) {
                    canvas[d] = frame.pixels[s];
                    canvas[d + 1] = frame.pixels[s + 1];
                    canvas[d + 2] = frame.pixels[s + 2];
                    canvas[d + 3] = sa;
                }
                else if (sa !== 0)
                    blendOver(frame.pixels, s, canvas, d);
            }
        output.push({ pixels: canvas.slice(), duration: frame.duration });
        if (frame.dispose)
            for (let y = y0; y < y1; y++)
                canvas.fill(0, (y * width + x0) * 4, (y * width + x1) * 4);
    }
    return output;
}
function blendOver(src, s, dst, d) {
    const sa = src[s + 3], da = dst[d + 3];
    const dstFactor = da * (256 - sa) >> 8;
    const alpha = sa + dstFactor;
    const scale = alpha ? Math.floor((1 << 24) / alpha) : 0;
    for (let c = 0; c < 3; c++) {
        const blended = src[s + c] * sa + dst[d + c] * dstFactor;
        dst[d + c] = blended * scale >>> 24;
    }
    dst[d + 3] = alpha;
}
function riffChunk(type, body) {
    const out = new Uint8Array(8 + body.length + (body.length & 1));
    const view = new DataView(out.buffer);
    view.setUint32(0, fourCC(type), true);
    view.setUint32(4, body.length, true);
    out.set(body, 8);
    return out;
}
function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}
function riff(chunks) {
    let size = 4;
    for (const c of chunks)
        size += c.length;
    const out = new Uint8Array(8 + size);
    const view = new DataView(out.buffer);
    view.setUint32(0, RIFF, true);
    view.setUint32(4, size, true);
    view.setUint32(8, WEBP, true);
    let offset = 12;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
    }
    return out;
}
function toARGB(rgba, count) {
    const argb = new Uint32Array(count);
    for (let i = 0, o = 0; i < count; i++, o += 4)
        argb[i] = (rgba[o + 3] << 24 | rgba[o] << 16 | rgba[o + 1] << 8 | rgba[o + 2]) >>> 0;
    return argb;
}
const set24 = (d, o, v) => { d[o] = v & 255; d[o + 1] = v >> 8 & 255; d[o + 2] = v >> 16 & 255; };
const hasAlpha = (rgba) => {
    for (let i = 3; i < rgba.length; i += 4)
        if (rgba[i] !== 255)
            return true;
    return false;
};
const MIN_THREADED_PIXELS = 1536 << 10, PIXELS_PER_THREAD = 512 << 10;
export async function encode(rgba, width, height, exif, threads = 1, effort = 2) {
    const n = Math.min(threads, Math.floor(width * height / PIXELS_PER_THREAD));
    const pool = n > 1 && width * height >= MIN_THREADED_PIXELS ? startThreads(n) : null;
    let stream;
    try {
        stream = await vp8l.encode(toARGB(rgba, width * height), width, height, pool, effort);
    }
    catch (e) {
        if (!pool)
            throw e;
        stream = await vp8l.encode(toARGB(rgba, width * height), width, height, null, effort);
    }
    finally {
        if (pool)
            for (const t of pool)
                t.terminate();
    }
    const bitstream = riffChunk('VP8L', stream);
    if (!exif)
        return riff([bitstream]);
    const vp8x = new Uint8Array(10);
    vp8x[0] = 8 | (hasAlpha(rgba.subarray(0, width * height * 4)) ? 16 : 0);
    set24(vp8x, 4, width - 1);
    set24(vp8x, 7, height - 1);
    return riff([riffChunk('VP8X', vp8x), bitstream, riffChunk('EXIF', exif)]);
}
export function lossyOptions(quality, effort, sharp, alphaQuality) {
    checkEffort(effort, 6);
    if (quality === undefined)
        return undefined;
    const q = checkQuality(quality), a = checkQuality(alphaQuality, 'alphaQuality');
    return { quality: q, method: effort, sharp, alphaQuality: Math.round(a) };
}
export async function encodeLossy(rgba, width, height, lossy, exif) {
    const { alpha, chunks } = await lossyChunks(rgba, width, height, lossy);
    if (!alpha && !exif)
        return riff(chunks);
    const vp8x = new Uint8Array(10);
    vp8x[0] = (exif ? 8 : 0) | (alpha ? 16 : 0);
    set24(vp8x, 4, width - 1);
    set24(vp8x, 7, height - 1);
    return riff([riffChunk('VP8X', vp8x), ...chunks, ...exif ? [riffChunk('EXIF', exif)] : []]);
}
async function lossyChunks(rgba, width, height, { quality, method, sharp, alphaQuality }) {
    if (width > 16383 || height > 16383)
        throw new RangeError('WebP: lossy images can be at most 16383 pixels wide and high');
    const picture = rgbaToYUV(rgba, width, height, sharp);
    const frame = encodeVP8(picture, quality, method);
    const padded = new Uint8Array(frame.length + (frame.length & 1));
    padded.set(frame);
    const chunks = [riffChunk('VP8 ', padded)];
    if (picture.a)
        chunks.unshift(riffChunk('ALPH', await encodeAlpha(picture.a, width, height, method, alphaQuality)));
    return { alpha: !!picture.a, chunks };
}
export function lossyTolerance(quality) {
    const value = Math.sqrt(quality / 100);
    return Math.max(1, Math.round(31 * (1 - value) + value));
}
export async function encodeAnimation(frames, width, height, plays, exif, lossy, effort = 2) {
    if (!frames.length)
        throw new Error('WebP: an animation needs at least one frame');
    if (width > 1 << 24 || height > 1 << 24)
        throw new RangeError('WebP: canvas too large');
    let alpha = false;
    for (const [i, f] of frames.entries())
        alpha ||= needsAlpha(f, i === 0, width, height);
    const chunks = [];
    for (const f of frames)
        chunks.push(await frameChunk(f, lossy, effort));
    return animationFile(chunks, width, height, plays, alpha, exif);
}
export function needsAlpha(f, first, width, height) {
    return (first && (f.x > 0 || f.y > 0 || f.width < width || f.height < height)) || f.dispose || hasAlpha(f.pixels);
}
export async function frameChunk(f, lossy, effort = 2) {
    if (f.x & 1 || f.y & 1)
        throw new RangeError('WebP: frame offsets have to be even');
    const bitstream = !lossy ? riffChunk('VP8L', await vp8l.encode(toARGB(f.pixels, f.width * f.height), f.width, f.height, null, effort))
        : concat((await lossyChunks(f.pixels, f.width, f.height, lossy)).chunks);
    const header = new Uint8Array(16);
    set24(header, 0, f.x >> 1);
    set24(header, 3, f.y >> 1);
    set24(header, 6, f.width - 1);
    set24(header, 9, f.height - 1);
    set24(header, 12, Math.min(0xffffff, Math.max(0, Math.round(f.duration))));
    header[15] = (f.blend === false ? 2 : 0) | (f.dispose ? 1 : 0);
    const body = new Uint8Array(16 + bitstream.length);
    body.set(header);
    body.set(bitstream, 16);
    return riffChunk('ANMF', body);
}
export function animationFile(frames, width, height, plays, alpha, exif) {
    const vp8x = new Uint8Array(10);
    vp8x[0] = 2 | (alpha ? 16 : 0) | (exif ? 8 : 0);
    set24(vp8x, 4, width - 1);
    set24(vp8x, 7, height - 1);
    const anim = new Uint8Array(6);
    anim[4] = plays & 255;
    anim[5] = plays >> 8 & 255;
    const chunks = [riffChunk('VP8X', vp8x), riffChunk('ANIM', anim), ...frames];
    if (exif)
        chunks.push(riffChunk('EXIF', exif));
    return riff(chunks);
}
