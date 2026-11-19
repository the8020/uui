import * as gifCodec from "./codecs/gif.js";
import * as png from "./codecs/png.js";
import * as webp from "./codecs/webp.js";
import { Image } from "./image.js";
import { Frame } from "./frame.js";
import { Optimizer, Compositor, coverCanvas, fillUnchanged } from "./util/optimize.js";
import { compressAsync, decompressAsync } from "./codecs/zlib.js";
import { resolveMetadata, pngText, exifData, gifComments } from "./metadata.js";
import { finite, compressionLevel, fitLoops } from "./util/options.js";
const toPlays = (loopCount) => loopCount < 0 || loopCount === Infinity ? 0 : loopCount + 1;
export class AnimationEncoder {
    format;
    optimizer;
    queue = Promise.resolve();
    count = 0;
    finished = false;
    width;
    height;
    constructor(width, height, format, optimize) {
        this.format = format;
        this.width = width;
        this.height = height;
        this.optimizer = optimize ? new Optimizer(width, height, format.optimize) : null;
    }
    get frameCount() {
        return this.count;
    }
    get frames() {
        return this.count;
    }
    add(frame, options = {}) {
        if (this.finished)
            throw new Error('The animation encoder is finished');
        if (!(frame instanceof Image))
            throw new TypeError('Invalid frame passed');
        const own = frame instanceof Frame ? frame : null;
        const duration = options.duration ?? own?.duration ?? 100;
        const x = options.xOffset ?? own?.xOffset ?? 0, y = options.yOffset ?? own?.yOffset ?? 0;
        if (finite(duration, 'frame duration') < 0)
            throw new RangeError('Invalid frame duration');
        finite(x, 'x offset');
        finite(y, 'y offset');
        const disposal = options.disposalMode !== undefined ? Frame.__convert_disposal_mode__(options.disposalMode) : own ? own.__disposal_id__ : 1;
        const input = {
            x, y, width: frame.width, height: frame.height, duration, disposal,
            dispose: [0, 0, 2, 1][disposal],
            pixels: new Uint8Array(frame.bitmap.buffer, frame.bitmap.byteOffset, frame.bitmap.byteLength).slice()
        };
        this.count++;
        return this.queue = this.queue.then(async () => {
            if (!this.optimizer)
                return this.format.frame(input, false);
            this.optimizer.push(input);
            for (const f of this.optimizer.take())
                await this.format.frame(f, true);
        });
    }
    async finish() {
        if (this.finished)
            throw new Error('The animation encoder is finished');
        this.finished = true;
        await this.queue;
        if (!this.count)
            throw new Error('An animation needs at least one frame');
        if (this.optimizer)
            for (const f of this.optimizer.end())
                await this.format.frame(f, true);
        const optimizer = this.optimizer;
        this.optimizer = null;
        return this.format.file(optimizer);
    }
    static __webp__(width, height, { loopCount = -1, metadata = {}, optimize = true, quality, effort = 2, sharpYuv = false, alphaQuality = 100 }) {
        canvas(width, height, loopCount);
        fitLoops(loopCount, 'WebP');
        if (width > 1 << 24 || height > 1 << 24)
            throw new RangeError('WebP: canvas too large');
        const lossy = webp.lossyOptions(quality, effort, sharpYuv, alphaQuality);
        const resolved = resolveMetadata(metadata), chunks = [];
        let alpha = false;
        const compositor = optimize ? null : new Compositor(width, height);
        let full = false;
        const add = async (f) => {
            alpha ||= webp.needsAlpha(f, !chunks.length, width, height);
            chunks.push(await webp.frameChunk(f, lossy, effort));
        };
        return new AnimationEncoder(width, height, {
            optimize: { replace: true, even: true, alpha: 'frame', tolerance: lossy ? webp.lossyTolerance(lossy.quality) : undefined },
            async frame(f, optimized) {
                if (optimized)
                    return add(f);
                const input = f;
                const shown = compositor.push(input);
                full ||= input.dispose === 2 || (input.dispose === 1 && !!(input.x & 1 || input.y & 1));
                if (full)
                    return add({ x: 0, y: 0, width, height, duration: input.duration, dispose: true, blend: false, pixels: shown });
                await add(webpFrame(input));
            },
            file: () => webp.animationFile(chunks, width, height, toPlays(loopCount), alpha, exifData(resolved))
        }, optimize);
    }
    static __gif__(width, height, { loopCount = -1, metadata = {}, optimize = true, quality: qualityOption = 95 }) {
        const quality = finite(qualityOption, 'quality');
        canvas(width, height, loopCount);
        fitLoops(loopCount, 'GIF');
        const comments = gifComments(resolveMetadata(metadata));
        let first = null, restores = false;
        const rest = [];
        return new AnimationEncoder(width, height, {
            optimize: { replace: false, even: false, alpha: 'frame', palette: 256, cover: true },
            async frame(f, optimized) {
                if (!first && optimized)
                    coverCanvas(f, width, height);
                const gif = { x: f.x, y: f.y, width: f.width, height: f.height, pixels: f.pixels,
                    dispose: optimized ? (f.dispose ? 3 : 1) : f.disposal,
                    delay: Math.round(f.duration / 10) };
                restores ||= gif.dispose === 3;
                if (!first)
                    first = gif;
                else
                    rest.push(gifCodec.encodeFrame(gif, quality, gif.dispose === 3));
            },
            file() {
                const f = first;
                return concat([gifCodec.header(width, height, loopCount, comments), gifCodec.encodeFrame(f, quality, f.dispose === 3 || restores), ...rest, new Uint8Array([0x3b])]);
            }
        }, optimize);
    }
    static __apng__(width, height, { loopCount = -1, metadata = {}, optimize = true, compression: compressionOption = 4 }) {
        const compression = compressionLevel(compressionOption);
        canvas(width, height, loopCount);
        fitLoops(loopCount, 'APNG');
        const text = pngText(resolveMetadata(metadata));
        const stored = [];
        const cost = new png.AlphaCost();
        let blended = false;
        return new AnimationEncoder(width, height, {
            optimize: { replace: true, even: false, alpha: () => cost.cost() },
            async frame(f, optimized) {
                let frame;
                if (optimized) {
                    const o = f;
                    cost.add(o.pixels);
                    blended ||= o.blend;
                    frame = { x: o.x, y: o.y, width: o.width, height: o.height, duration: o.duration, dispose: o.dispose ? 1 : 0, blend: o.blend, pixels: o.pixels };
                }
                else {
                    frame = { x: f.x, y: f.y, width: f.width, height: f.height, duration: f.duration, dispose: f.dispose, pixels: f.pixels };
                    png.checkFrame(stored.length ? frame : png.coverCanvas(frame, width, height), width, height);
                }
                const { pixels, ...rest } = frame;
                stored.push({ frame: rest, packed: await compressAsync(pixels, 1) });
            },
            async file(optimizer) {
                const fill = !!optimizer && optimizer.opaque && blended && optimizer.denseTotal < optimizer.chosenTotal * cost.cost();
                const frames = async function* () {
                    const shown32 = new Int32Array(width * height);
                    for (const [i, { frame, packed }] of stored.entries()) {
                        let f = { ...frame, pixels: await decompressAsync(packed, frame.width * frame.height * 4) };
                        if (fill)
                            fillUnchanged(f, shown32, width);
                        if (i === 0)
                            f = png.coverCanvas(f, width, height);
                        yield f;
                    }
                };
                const scanner = new png.FormatScanner();
                for await (const f of frames())
                    scanner.add(f.pixels);
                const format = scanner.format(), encoded = [];
                for await (const { pixels, ...f } of frames())
                    encoded.push({ ...f, data: await png.frameData(pixels, f.width, f.height, format, compression) });
                return png.animationFile(encoded, width, height, toPlays(loopCount), format, text);
            }
        }, optimize);
    }
}
function canvas(width, height, loopCount) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
        throw new RangeError(`Invalid canvas size: ${width}x${height}`);
    if (loopCount !== Infinity && (!Number.isInteger(loopCount) || loopCount < -1))
        throw new RangeError('Invalid loop count');
}
function webpFrame(f) {
    let { x, y, width: w, height: h, pixels } = f;
    if (x & 1 || y & 1) {
        const dx = x & 1, dy = y & 1;
        const padded = new Uint8Array((w + dx) * (h + dy) * 4);
        for (let row = 0; row < h; row++)
            padded.set(pixels.subarray(row * w * 4, (row + 1) * w * 4), ((row + dy) * (w + dx) + dx) * 4);
        pixels = padded;
        x -= dx;
        y -= dy;
        w += dx;
        h += dy;
    }
    return { x, y, width: w, height: h, duration: f.duration, dispose: f.dispose === 1, pixels };
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
