import { colorSpaceTransform, profileTransform } from "./util/icc.js";
import * as gifCodec from "./codecs/gif.js";
import * as png from "./codecs/png.js";
import * as webp from "./codecs/webp.js";
import * as jxl from "./codecs/jxl.js";
import { availableThreads } from "./util/threads.js";
import { view } from "./util/mem.js";
import { GainMap } from "./gainmap.js";
import { Image, ResizeModes, resizeArguments } from "./image.js";
import { Frame, FrameDisposalModes } from "./frame.js";
import { ImageType } from "./image-type.js";
import { optimize } from "./util/optimize.js";
import { resolveMetadata, pngText, exifData, gifComments } from "./metadata.js";
import { isOptions, finite, compressionLevel, fitLoops } from "./util/options.js";
import { MAX_PIXELS, decoding } from "./util/limits.js";
import { AnimationEncoder } from "./animation-encoder.js";
const toPlays = (loopCount) => loopCount < 0 || loopCount === Infinity ? 0 : loopCount + 1;
const fromPlays = (plays) => plays === 0 ? -1 : plays - 1;
function canvasFrames(width, height, frames) {
    return frames.map(({ pixels, duration }) => {
        const frame = new Frame(width, height, duration, 0, 0, FrameDisposalModes.BACKGROUND);
        frame.bitmap = pixels;
        return frame;
    });
}
export class Animation extends Array {
    loopCount;
    constructor(frames, loopCountOrOptions = -1) {
        super();
        const { loopCount = -1 } = isOptions(loopCountOrOptions) ? loopCountOrOptions : { loopCount: loopCountOrOptions };
        for (const frame of frames)
            this.push(frame);
        for (let i = 0; i < this.length; i++)
            if (!(this[i] instanceof Frame))
                throw new TypeError(`Frame ${i} is not an instance of Frame`);
        if (loopCount !== Infinity && (finite(loopCount, 'loop count') < -1 || !Number.isInteger(Number(loopCount))))
            throw new RangeError(`Invalid loop count: ${loopCount}`);
        this.loopCount = loopCount;
    }
    static get [Symbol.species]() {
        return Array;
    }
    get frames() {
        return this;
    }
    set frames(frames) {
        frames = Array.from(frames);
        frames.forEach((frame, i) => {
            if (!(frame instanceof Frame))
                throw new TypeError(`Frame ${i} is not an instance of Frame`);
        });
        this.length = 0;
        for (const frame of frames)
            this.push(frame);
    }
    get width() {
        let max = 0;
        for (const frame of this)
            max = Math.max(max, frame.width + frame.xOffset);
        return max;
    }
    get height() {
        let max = 0;
        for (const frame of this)
            max = Math.max(max, frame.height + frame.yOffset);
        return max;
    }
    get duration() {
        let duration = 0;
        for (const frame of this)
            duration += frame.duration;
        return duration;
    }
    toString() {
        return `Animation<${this.width}x${this.height}x${this.duration}ms>`;
    }
    slice(start, end) {
        const Class = this.constructor;
        return new Class(Array.prototype.slice.call(this, start, end), this.loopCount);
    }
    resize(widthOrOptions, heightArgument, modeArgument) {
        let [width, height, modeOrOptions] = resizeArguments(widthOrOptions, heightArgument, modeArgument);
        const originalWidth = this.width, originalHeight = this.height;
        if (width === ResizeModes.AUTO && height === ResizeModes.AUTO)
            throw new Error('RESIZE_AUTO can only be used for either width or height, not for both');
        if (width === ResizeModes.AUTO)
            width = originalWidth / originalHeight * height;
        if (height === ResizeModes.AUTO)
            height = originalHeight / originalWidth * width;
        const sx = width / originalWidth, sy = height / originalHeight;
        for (const frame of this) {
            const left = Math.round(frame.xOffset * sx), top = Math.round(frame.yOffset * sy);
            const right = Math.round((frame.xOffset + frame.width) * sx), bottom = Math.round((frame.yOffset + frame.height) * sy);
            Image.prototype.resize
                .call(frame, Math.max(1, right - left), Math.max(1, bottom - top), modeOrOptions);
            frame.xOffset = left;
            frame.yOffset = top;
        }
        return this;
    }
    __validate__() {
        for (const frame of this)
            if (!(frame instanceof Frame))
                throw new Error('Animation contains invalid frames');
    }
    async encodeGIF(qualityOrOptions = 95) {
        const { quality = 95, metadata = {}, optimize = true } = isOptions(qualityOrOptions) ? qualityOrOptions : { quality: qualityOrOptions };
        fitLoops(this.loopCount, 'GIF');
        this.__validate__();
        const frames = optimize
            ? this.__optimized__({ replace: false, even: false, alpha: 'frame', palette: 256, cover: true }).map(f => ({ ...f, dispose: f.dispose ? 3 : 1 }))
            : Array.from(this, frame => ({
                x: frame.xOffset,
                y: frame.yOffset,
                width: frame.width,
                height: frame.height,
                duration: frame.duration,
                dispose: frame.__disposal_id__,
                pixels: new Uint8Array(frame.bitmap.buffer, frame.bitmap.byteOffset, frame.bitmap.byteLength)
            }));
        const gifFrames = frames.map(({ duration, ...f }) => ({ ...f, delay: Math.round(duration / 10) }));
        return gifCodec.encode({ width: this.width, height: this.height, loopCount: this.loopCount, frames: gifFrames }, finite(quality, 'quality'), gifComments(resolveMetadata(metadata)));
    }
    async encodeAPNG(compressionOrOptions = 4) {
        const { compression = 4, metadata = {}, optimize = true } = isOptions(compressionOrOptions) ? compressionOrOptions : { compression: compressionOrOptions };
        fitLoops(this.loopCount, 'APNG');
        this.__validate__();
        if (!this.length)
            throw new Error('An animation needs at least one frame');
        const frames = optimize
            ? this.__optimized__({ replace: true, even: false, alpha: frames => png.alphaCost(frames.map(f => f.pixels)) }).map(f => ({ ...f, dispose: f.dispose ? 1 : 0 }))
            : this.__apngFrames__().map(({ blend: _, ...f }) => f);
        return png.encodeAnimation(frames, this.width, this.height, toPlays(this.loopCount), compressionLevel(compression), pngText(resolveMetadata(metadata)));
    }
    async encodeWebP({ metadata = {}, optimize = true, quality, effort = 2, sharpYuv = false, alphaQuality = 100 } = {}) {
        fitLoops(this.loopCount, 'WebP');
        this.__validate__();
        if (!this.length)
            throw new Error('An animation needs at least one frame');
        const lossy = webp.lossyOptions(quality, effort, sharpYuv, alphaQuality);
        const tolerance = lossy ? webp.lossyTolerance(lossy.quality) : undefined;
        const frames = optimize ? this.__optimized__({ replace: true, even: true, alpha: 'frame', tolerance }) : this.__webpFrames__();
        return webp.encodeAnimation(frames, this.width, this.height, toPlays(this.loopCount), exifData(resolveMetadata(metadata)), lossy, effort);
    }
    __webpFrames__() {
        const width = this.width, height = this.height;
        const fullFrames = this.some(f => f.disposalMode === 'previous' || (f.disposalMode === 'background' && (f.xOffset & 1 || f.yOffset & 1)));
        if (fullFrames)
            return png.compositeAnimation({ width, height, frames: this.__apngFrames__() })
                .map(c => ({ x: 0, y: 0, width, height, duration: c.duration, dispose: true, pixels: c.pixels }));
        return Array.from(this, frame => {
            let { xOffset: x, yOffset: y, width: w, height: h } = frame;
            let pixels = new Uint8Array(frame.bitmap.buffer, frame.bitmap.byteOffset, frame.bitmap.byteLength);
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
            return { x, y, width: w, height: h, duration: frame.duration, dispose: frame.disposalMode === 'background', pixels };
        });
    }
    __optimized__(options) {
        return optimize(this.__apngFrames__(), this.width, this.height, options);
    }
    __apngFrames__() {
        const dispose = [0, 0, 2, 1];
        return Array.from(this, frame => ({
            x: frame.xOffset,
            y: frame.yOffset,
            width: frame.width,
            height: frame.height,
            duration: frame.duration,
            dispose: dispose[frame.__disposal_id__],
            blend: 1,
            pixels: new Uint8Array(frame.bitmap.buffer, frame.bitmap.byteOffset, frame.bitmap.byteLength)
        }));
    }
    static webpEncoder(width, height, options = {}) {
        return AnimationEncoder.__webp__(width, height, options);
    }
    static gifEncoder(width, height, options = {}) {
        return AnimationEncoder.__gif__(width, height, options);
    }
    static apngEncoder(width, height, options = {}) {
        return AnimationEncoder.__apng__(width, height, options);
    }
    static async decode(input, onlyFirstFrameOrOptions = false) {
        if (isOptions(onlyFirstFrameOrOptions)) {
            const { maxPixels = MAX_PIXELS, threads = 1 } = onlyFirstFrameOrOptions;
            if (!Number.isInteger(threads) || threads < 1)
                throw new RangeError(`threads must be a positive integer, not ${threads}`);
            if (!(Number(maxPixels) > 0))
                throw new RangeError(`maxPixels must be a positive number, not ${maxPixels}`);
            const { toneMapping = 'reinhard' } = onlyFirstFrameOrOptions;
            if (toneMapping !== 'reinhard' && toneMapping !== 'clamp')
                throw new TypeError(`toneMapping must be 'reinhard' or 'clamp', not ${String(toneMapping)}`);
        }
        return decoding(() => Animation.__decode__(input, onlyFirstFrameOrOptions));
    }
    static async __decode__(input, onlyFirstFrameOrOptions) {
        const { onlyFirstFrame: onlyExtractFirstFrame = false, maxPixels = MAX_PIXELS, applyColorProfile = true, threads = Math.max(1, Math.min(availableThreads(), 8)), applyOrientation = true, toneMapping = 'reinhard', gainMap = true } = isOptions(onlyFirstFrameOrOptions) ? onlyFirstFrameOrOptions : { onlyFirstFrame: onlyFirstFrameOrOptions };
        const orient = (frames, orientation) => {
            if (applyOrientation && orientation > 1)
                for (const frame of frames)
                    frame.__orient__(orientation);
            return frames;
        };
        const profile = (frames, icc, space) => {
            const transform = !applyColorProfile ? null : icc ? profileTransform(icc) : space ? colorSpaceTransform(space.xy, space.curve) : null;
            if (transform)
                for (const frame of frames)
                    transform(frame.bitmap);
            return frames;
        };
        const data = view(input);
        const type = ImageType.getType(data);
        if (type === 'gif')
            return Animation.__fromGIF__(data, onlyExtractFirstFrame, Animation, maxPixels);
        if (type === 'webp') {
            const decoded = webp.decodeAnimation(data, onlyExtractFirstFrame, maxPixels);
            const frames = orient(profile(canvasFrames(decoded.width, decoded.height, webp.composite(decoded)), decoded.icc), decoded.orientation);
            return new Animation(frames, fromPlays(decoded.loopCount));
        }
        if (type === 'png' && !png.isAnimated(data)) {
            const image = await Image.decode(data, { maxPixels, applyOrientation, applyColorProfile });
            return new Animation(canvasFrames(image.width, image.height, [{ pixels: image.bitmap, duration: 0 }]), -1);
        }
        if (type === 'png') {
            const decoded = await png.decodeAnimation(data, onlyExtractFirstFrame, maxPixels);
            const frames = orient(profile(canvasFrames(decoded.width, decoded.height, png.compositeAnimation(decoded)), decoded.icc), decoded.orientation);
            return new Animation(frames, decoded.frames.length > 1 ? fromPlays(decoded.plays) : -1);
        }
        if (type === 'jxl') {
            const frames = [];
            let loopCount = -1, icc, space;
            let orientation = 1;
            for await (const decoded of jxl.frames(data, maxPixels, toneMapping, threads)) {
                const frame = new Frame(decoded.width, decoded.height, decoded.duration, 0, 0, FrameDisposalModes.BACKGROUND);
                frame.bitmap = decoded.pixels;
                frames.push(frame);
                orientation = decoded.orientation;
                loopCount = fromPlays(decoded.loopCount);
                icc = decoded.icc;
                space = decoded.colorSpace;
                if (onlyExtractFirstFrame)
                    break;
            }
            const map = gainMap && data[0] !== 0xff ? await jxl.decodeGainMap(data, maxPixels).catch(() => undefined) : undefined;
            if (map)
                for (const frame of frames) {
                    const image = new Image(map.width, map.height);
                    image.bitmap = map.pixels.slice();
                    frame.gainMap = GainMap.__from_pixels__(image, map.params);
                }
            for (const frame of orient(profile(frames, icc, space), orientation)) {
                const mapOfFrame = frame.gainMap;
                if (!mapOfFrame || !applyOrientation || orientation <= 1)
                    continue;
                try {
                    mapOfFrame.image = mapOfFrame.image.__orient__(orientation);
                }
                catch {
                    frame.gainMap = null;
                }
            }
            return new Animation(frames, frames.length > 1 ? loopCount : -1);
        }
        if (type)
            return new Animation([Frame.from(await Image.decode(data, { maxPixels, applyOrientation, applyColorProfile, toneMapping, gainMap, threads }), 0)]);
        throw new Error('Unsupported image type');
    }
    static __fromGIF__(data, onlyExtractFirstFrame, Class, maxPixels = MAX_PIXELS) {
        return decoding(() => Animation.__gifFrames__(data, onlyExtractFirstFrame, Class, maxPixels));
    }
    static __gifFrames__(data, onlyExtractFirstFrame, Class, maxPixels) {
        const decoded = gifCodec.decode(data, onlyExtractFirstFrame, maxPixels);
        const frames = gifCodec.composite(decoded).map(({ pixels, delay }) => ({ pixels, duration: 10 * delay }));
        return new Class(canvasFrames(decoded.width, decoded.height, frames), decoded.loopCount);
    }
}
