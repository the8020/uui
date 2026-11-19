import * as png from "./codecs/png.js";
import * as jpeg from "./codecs/jpeg.js";
import * as tiff from "./codecs/tiff.js";
import * as webp from "./codecs/webp.js";
import * as gif from "./codecs/gif.js";
import * as tga from "./codecs/tga.js";
import * as bmp from "./codecs/bmp.js";
import * as ico from "./codecs/ico.js";
import * as qoi from "./codecs/qoi.js";
import * as netpbm from "./codecs/netpbm.js";
import * as hdr from "./codecs/hdr.js";
import * as avif from "./codecs/avif.js";
import * as avifEnc from "./codecs/avif-enc.js";
import { availableThreads } from "./util/threads.js";
const defaultThreads = () => Math.max(1, Math.min(availableThreads(), 8));
const checkThreads = (threads) => {
    if (!Number.isInteger(threads) || threads < 1)
        throw new RangeError(`threads must be a positive integer, not ${threads}`);
};
import * as jxl from "./codecs/jxl.js";
import * as quantize from "./codecs/quantize.js";
import * as textRenderer from "./render/text.js";
import * as svgRenderer from "./render/svg.js";
import { view } from "./util/mem.js";
import { cicpTransform, colorSpaceTransform, profileTransform } from "./util/icc.js";
import { ImageType } from "./image-type.js";
import { TextLayout } from "./text-layout.js";
import { resolveMetadata, pngText, exifData } from "./metadata.js";
import { encode as utf8 } from "./util/utf8.js";
import { resample, BOX, TRIANGLE, CUBIC } from "./util/resample.js";
import { rotateBilinear } from "./util/rotate.js";
import { gaussianBlur, boxBlurRGBA, premultiply, unpremultiply } from "./util/blur.js";
import { Colors, wrapHue, hue2rgb, rgbaToHSLA } from "./colors.js";
import { isOptions, finite, color as checkColor, quality as checkQuality, effort as checkEffort, compressionLevel } from "./util/options.js";
import { MAX_PIXELS, decoding } from "./util/limits.js";
import { GainMap } from "./gainmap.js";
import * as gain from "./util/gain.js";
import { multiply, invert } from "./util/matrix.js";
import { sampleAffine } from "./util/affine.js";
import * as gainMapCodec from "./codecs/gainmap.js";
export class ResizeModes {
    static NEAREST_NEIGHBOR = 'nearest-neighbor';
    static BILINEAR = 'bilinear';
    static BICUBIC = 'bicubic';
    static AREA = 'area';
    static AUTO = -1;
    constructor() { }
}
export class SVGScaleModes {
    static SCALE = 'scale';
    static WIDTH = 'width';
    static HEIGHT = 'height';
    constructor() { }
}
const DITHER_METHODS = ['none', 'floyd-steinberg', 'atkinson', 'ordered'];
const TRANSFORM_MODES = ['nearest-neighbor', 'bilinear', 'bicubic'];
function featureList(features) {
    if (typeof features !== 'object' || features === null)
        throw new TypeError('Features must be an object');
    return Object.entries(features).map(([tag, value]) => {
        if (!/^[\x20-\x7e]{4}$/.test(tag))
            throw new RangeError(`Invalid OpenType feature tag: ${JSON.stringify(tag)}`);
        if (typeof value === 'boolean')
            return [tag, value ? 1 : 0];
        if (!Number.isInteger(value) || value < 0 || value > 255)
            throw new RangeError(`Invalid value of the OpenType feature ${tag}: ${value}`);
        return [tag, value];
    });
}
export class Image {
    __width__;
    __height__;
    __view__;
    __u32__;
    __bitmap__;
    __gain_map__ = null;
    constructor(width, height) {
        width = ~~width;
        height = ~~height;
        if (width < 1)
            throw new RangeError('Image has to be at least 1 pixel wide');
        if (height < 1)
            throw new RangeError('Image has to be at least 1 pixel high');
        this.__width__ = width;
        this.__height__ = height;
        this.__set_bitmap__(new Uint8ClampedArray(width * height * 4));
    }
    get gainMap() {
        return this.__gain_map__;
    }
    set gainMap(gainMap) {
        if (gainMap !== null && !(gainMap instanceof GainMap))
            throw new TypeError('The gain map has to be a GainMap or null');
        this.__gain_map__ = gainMap;
    }
    get bitmap() {
        return this.__bitmap__;
    }
    set bitmap(bitmap) {
        if (!(bitmap instanceof Uint8ClampedArray || bitmap instanceof Uint8Array))
            throw new TypeError('The bitmap has to be a Uint8ClampedArray or Uint8Array');
        if (bitmap.length !== this.width * this.height * 4)
            throw new RangeError(`The bitmap has to have ${this.width * this.height * 4} bytes (width * height * 4), got ${bitmap.length}`);
        this.__set_bitmap__(bitmap instanceof Uint8ClampedArray ? bitmap : new Uint8ClampedArray(bitmap.buffer, bitmap.byteOffset, bitmap.length));
    }
    __set_bitmap__(bitmap) {
        if (bitmap.byteOffset % 4)
            bitmap = bitmap.slice();
        this.__bitmap__ = bitmap;
        this.__view__ = new DataView(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength);
        this.__u32__ = new Uint32Array(bitmap.buffer, bitmap.byteOffset, bitmap.length >> 2);
    }
    toString() {
        return `Image<${this.width}x${this.height}>`;
    }
    get width() {
        return this.__width__;
    }
    get height() {
        return this.__height__;
    }
    *coordinates() {
        for (let y = 0; y < this.height; y++)
            for (let x = 0; x < this.width; x++)
                yield [x, y];
    }
    *pixels() {
        const view = new DataView(this.bitmap.buffer, this.bitmap.byteOffset, this.bitmap.byteLength);
        let offset = 0;
        for (let y = 0; y < this.height; y++)
            for (let x = 0; x < this.width; x++, offset += 4)
                yield [x, y, view.getUint32(offset, false)];
    }
    *[Symbol.iterator]() {
        yield* this.coordinates();
    }
    *iterateWithColors() {
        yield* this.pixels();
    }
    static rgbaToColor(r, g, b, a) {
        return Colors.fromRGBA(r, g, b, a);
    }
    static rgbToColor(r, g, b) {
        return Colors.fromRGB(r, g, b);
    }
    static hslaToColor(h, s, l, a) {
        return Colors.fromHSLA(h, s, l, a);
    }
    static hslToColor(h, s, l) {
        return Colors.fromHSL(h, s, l);
    }
    static rgbaToHSLA(r, g, b, a) {
        return rgbaToHSLA(r, g, b, a);
    }
    static colorToRGBA(color) {
        return Colors.toRGBA(color);
    }
    static colorToRGB(color) {
        return Colors.toRGB(color);
    }
    static linearGradient(width, height, options) {
        const { stops, angle = 180 } = options;
        const color = gradientFunction(stops);
        finite(angle, 'angle');
        const image = new Image(width, height);
        const radians = angle * Math.PI / 180;
        const dx = Math.sin(radians), dy = -Math.cos(radians);
        const length = Math.abs(width * dx) + Math.abs(height * dy);
        const cx = width / 2, cy = height / 2, bitmap = new DataView(image.bitmap.buffer, image.bitmap.byteOffset, image.bitmap.byteLength);
        for (let y = 0, i = 0; y < height; y++)
            for (let x = 0; x < width; x++, i += 4)
                bitmap.setUint32(i, color(((x + 0.5 - cx) * dx + (y + 0.5 - cy) * dy) / length + 0.5), false);
        return image;
    }
    static radialGradient(width, height, options) {
        const { stops, x: cx = width / 2, y: cy = height / 2, radius = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)) } = options;
        const color = gradientFunction(stops);
        finite(cx, 'x');
        finite(cy, 'y');
        if (!(finite(radius, 'radius') > 0))
            throw new RangeError('Invalid radius');
        const image = new Image(width, height);
        const bitmap = new DataView(image.bitmap.buffer, image.bitmap.byteOffset, image.bitmap.byteLength);
        for (let y = 0, i = 0; y < height; y++)
            for (let x = 0; x < width; x++, i += 4)
                bitmap.setUint32(i, color(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius), false);
        return image;
    }
    static gradient(colors) {
        return Colors.gradient(colors);
    }
    getPixelAt(x, y) {
        x = ~~finite(x, 'x');
        y = ~~finite(y, 'y');
        this.__check_boundaries__(x, y);
        return this.__view__.getUint32((y * this.width + x) * 4, false);
    }
    getRGBAAt(x, y) {
        x = ~~finite(x, 'x');
        y = ~~finite(y, 'y');
        this.__check_boundaries__(x, y);
        const idx = (y * this.width + x) * 4;
        return this.bitmap.subarray(idx, idx + 4);
    }
    setPixelAt(x, y, pixelColor) {
        x = ~~finite(x, 'x');
        y = ~~finite(y, 'y');
        this.__check_boundaries__(x, y);
        this.__set_pixel__(x, y, checkColor(pixelColor));
        return this;
    }
    __set_pixel__(x, y, pixelColor) {
        this.__view__.setUint32((y * this.width + x) * 4, pixelColor, false);
    }
    __check_boundaries__(x, y) {
        if (isNaN(x))
            throw new TypeError(`Invalid pixel coordinates (x=${x})`);
        if (isNaN(y))
            throw new TypeError(`Invalid pixel coordinates (y=${y})`);
        if (x < 0)
            throw new RangeError(`${Image.__out_of_bounds__} (x=${x})<0`);
        if (x >= this.width)
            throw new RangeError(`${Image.__out_of_bounds__} (x=${x})>=(width=${this.width})`);
        if (y < 0)
            throw new RangeError(`${Image.__out_of_bounds__} (y=${y})<0`);
        if (y >= this.height)
            throw new RangeError(`${Image.__out_of_bounds__} (y=${y})>=(height=${this.height})`);
    }
    static get __out_of_bounds__() {
        return 'Tried referencing a pixel outside of the images boundaries:';
    }
    fill(color) {
        const view = new DataView(this.bitmap.buffer, this.bitmap.byteOffset, this.bitmap.byteLength);
        if (typeof color !== 'function')
            color = checkColor(color);
        if (this.__gain_map__)
            this.__gain_map__ = gain.neutralMap(this.__gain_map__, this.width, this.width, this.height);
        if (typeof color === 'function') {
            let offset = 0;
            for (let y = 0; y < this.height; y++)
                for (let x = 0; x < this.width; x++, offset += 4)
                    view.setUint32(offset, color(x, y), false);
        }
        else {
            if (!this.bitmap.length)
                return this;
            view.setUint32(0, color, false);
            const u32 = new Uint32Array(this.bitmap.buffer, this.bitmap.byteOffset, this.bitmap.byteLength / 4);
            u32.fill(u32[0]);
        }
        return this;
    }
    clone() {
        const image = new Image(1, 1);
        image.__width__ = this.width;
        image.__height__ = this.height;
        image.__set_bitmap__(new Uint8ClampedArray(this.bitmap));
        image.__gain_map__ = this.__gain_map__ ? this.__gain_map__.clone() : null;
        return image;
    }
    static RESIZE_NEAREST_NEIGHBOR = 'RESIZE_NEAREST_NEIGHBOR';
    static RESIZE_BILINEAR = 'RESIZE_BILINEAR';
    static RESIZE_BICUBIC = 'RESIZE_BICUBIC';
    static RESIZE_AREA = 'RESIZE_AREA';
    static RESIZE_AUTO = ResizeModes.AUTO;
    scale(factor, modeOrOptions) {
        const { mode, fast } = resizeOptions(modeOrOptions);
        const image = this.__scale__(factor, mode, fast);
        this.__gain_map__?.__rescale__(this.width, this.height, image.width, image.height);
        return this.__apply__(image);
    }
    __scale__(factor, mode = ResizeModes.BILINEAR, fast = true) {
        if (factor === 1)
            return this;
        return this.__resize__(this.width * factor, this.height * factor, mode, fast);
    }
    resize(widthOrOptions, heightArgument, modeArgument) {
        const [width, height, modeOrOptions] = resizeArguments(widthOrOptions, heightArgument, modeArgument);
        const { mode, fast } = resizeOptions(modeOrOptions);
        const image = this.__resize__(width, height, mode, fast);
        this.__gain_map__?.__rescale__(this.width, this.height, image.width, image.height);
        return this.__apply__(image);
    }
    contain(width, height, modeOrOptions) {
        const options = resizeOptions(modeOrOptions);
        width = Math.floor(finite(width, 'width'));
        height = Math.floor(finite(height, 'height'));
        const scale = Math.min(width / this.width, height / this.height);
        return this.resize(Math.max(1, Math.min(width, Math.round(this.width * scale))), Math.max(1, Math.min(height, Math.round(this.height * scale))), options);
    }
    fit(width, height, modeOrOptions) {
        const options = resizeOptions(modeOrOptions);
        const result = new Image(width, height);
        this.contain(width, height, options);
        const x = (width - this.width) / 2 | 0, y = (height - this.height) / 2 | 0;
        result.composite(this, x, y);
        this.__gain_map__?.__transform__(this.width, this.height, result.width, result.height, (X, Y) => [X - x, Y - y]);
        return this.__apply__(result);
    }
    cover(width, height, modeOrOptions) {
        const options = resizeOptions(modeOrOptions);
        width = Math.floor(width);
        height = Math.floor(height);
        if (!(width >= 1 && Number.isFinite(width)))
            throw new RangeError('Image has to be at least 1 pixel wide');
        if (!(height >= 1 && Number.isFinite(height)))
            throw new RangeError('Image has to be at least 1 pixel high');
        const scale = Math.max(width / this.width, height / this.height);
        const resizedWidth = Math.max(width, Math.round(this.width * scale)), resizedHeight = Math.max(height, Math.round(this.height * scale));
        if (options.mode !== ResizeModes.NEAREST_NEIGHBOR && width >= 1 && height >= 1) {
            const region = { x: ~~((resizedWidth - width) / 2), y: ~~((resizedHeight - height) / 2), width, height };
            this.__rescaled__?.(resizedWidth, resizedHeight);
            const fx = resizedWidth / this.width, fy = resizedHeight / this.height;
            this.__gain_map__?.__transform__(this.width, this.height, width, height, (X, Y) => [(X + region.x) / fx, (Y + region.y) / fy], Math.min(fx, fy));
            return this.__apply__(this.__resize__(resizedWidth, resizedHeight, options.mode, options.fast, region));
        }
        this.resize(resizedWidth, resizedHeight, options);
        return this.crop((this.width - width) / 2, (this.height - height) / 2, width, height);
    }
    __resize__(width, height, mode = ResizeModes.BILINEAR, fast = true, region) {
        if (width === ResizeModes.AUTO && height === ResizeModes.AUTO)
            throw new Error('RESIZE_AUTO can only be used for either width or height, not for both');
        else if (width === ResizeModes.AUTO)
            width = Math.max(1, Math.round(this.width / this.height * Math.floor(height)));
        else if (height === ResizeModes.AUTO)
            height = Math.max(1, Math.round(this.height / this.width * Math.floor(width)));
        width = Math.floor(width);
        height = Math.floor(height);
        if (width < 1)
            throw new RangeError('Image has to be at least 1 pixel wide');
        if (height < 1)
            throw new RangeError('Image has to be at least 1 pixel high');
        if (mode === ResizeModes.NEAREST_NEIGHBOR)
            return this.__resize_nearest_neighbor__(width, height);
        const filter = mode === ResizeModes.BILINEAR ? TRIANGLE : mode === ResizeModes.BICUBIC ? CUBIC : mode === ResizeModes.AREA ? BOX : null;
        if (!filter)
            throw new Error('Invalid resize mode');
        const image = new Image(region?.width ?? width, region?.height ?? height);
        resample(this.bitmap, this.width, this.height, width, height, filter, image.bitmap, fast, region);
        return image;
    }
    __resize_nearest_neighbor__(width, height) {
        const image = new Image(width, height);
        const src = this.__u32__;
        const dst = image.__u32__;
        for (let y = 0; y < height; y++) {
            const row = this.width * ((y + 0.5) * (this.height / height) | 0);
            for (let x = 0; x < width; x++)
                dst[y * width + x] = src[row + ((x + 0.5) * (this.width / width) | 0)];
        }
        return image;
    }
    crop(x, y, width, height) {
        const bounds = this.__crop_bounds__(x, y, width, height);
        this.__crop_gain_map__(this, ...bounds);
        return this.__apply__(this.__crop__(...bounds));
    }
    __crop_gain_map__(target, x, y, width, height) {
        const map = this.__gain_map__;
        if (!map)
            return;
        const copy = target === this ? map : map.clone();
        copy.__transform__(this.width, this.height, width, height, (X, Y) => [X + x, Y + y]);
        target.__gain_map__ = copy;
    }
    region(x, y, width, height) {
        const bounds = this.__crop_bounds__(x, y, width, height);
        const image = this.__crop__(...bounds);
        this.__crop_gain_map__(image, ...bounds);
        return image;
    }
    __crop_bounds__(x, y, width, height) {
        x = ~~finite(x, 'x');
        y = ~~finite(y, 'y');
        width = ~~finite(width, 'width');
        height = ~~finite(height, 'height');
        const left = Math.max(0, x), top = Math.max(0, y);
        const right = Math.min(this.width, x + width), bottom = Math.min(this.height, y + height);
        if (right <= left || bottom <= top)
            throw new RangeError('Crop region does not overlap the image');
        return [left, top, right - left, bottom - top];
    }
    trim(colorOrOptions, optionsArgument = {}) {
        const { color, ...options } = isOptions(colorOrOptions) ? colorOrOptions : { ...optionsArgument, color: colorOrOptions ?? optionsArgument.color };
        const bounds = this.__trim_bounds__(color, options);
        if (!bounds)
            return this;
        this.__crop_gain_map__(this, ...bounds);
        return this.__apply__(this.__crop__(...bounds));
    }
    __trim_bounds__(color, { tolerance = 0 }) {
        if (!(tolerance >= 0 && tolerance <= 1))
            throw new RangeError('Invalid tolerance, it has to be between 0 and 1');
        const bitmap = this.bitmap;
        const { width, height } = this;
        if (color !== undefined)
            color = checkColor(color);
        const c = color === undefined ? [bitmap[0], bitmap[1], bitmap[2], bitmap[3]] : [color >>> 24, color >> 16 & 255, color >> 8 & 255, color & 255];
        const limit = tolerance * 255;
        const matches = (x, y) => {
            const i = (y * width + x) * 4;
            if (Math.abs(bitmap[i + 3] - c[3]) > limit)
                return false;
            if (bitmap[i + 3] === 0 && c[3] === 0)
                return true;
            return Math.abs(bitmap[i] - c[0]) <= limit && Math.abs(bitmap[i + 1] - c[1]) <= limit && Math.abs(bitmap[i + 2] - c[2]) <= limit;
        };
        const rowMatches = (y) => {
            for (let x = 0; x < width; x++)
                if (!matches(x, y))
                    return false;
            return true;
        };
        const columnMatches = (x, top, bottom) => {
            for (let y = top; y < bottom; y++)
                if (!matches(x, y))
                    return false;
            return true;
        };
        let top = 0, bottom = height;
        while (top < height && rowMatches(top))
            top++;
        if (top === height)
            return null;
        while (rowMatches(bottom - 1))
            bottom--;
        let left = 0, right = width;
        while (columnMatches(left, top, bottom))
            left++;
        while (columnMatches(right - 1, top, bottom))
            right--;
        return [left, top, right - left, bottom - top];
    }
    __crop__(x, y, width, height) {
        x = ~~x;
        y = ~~y;
        const image = new Image(width, height);
        for (let tY = 0; tY < height; tY++) {
            const idx = (tY + y) * this.width + x;
            image.__u32__.set(this.__u32__.subarray(idx, idx + width), tY * width);
        }
        return image;
    }
    drawBox(x, y, width, height, color) {
        x = ~~finite(x, 'x');
        y = ~~finite(y, 'y');
        width = ~~finite(width, 'width');
        height = ~~finite(height, 'height');
        if (typeof color !== 'function')
            this.__fast_box__(x, y, width, height, checkColor(color));
        else
            for (let tY = Math.max(0, -y); tY < height && tY + y < this.height; tY++)
                for (let tX = Math.max(0, -x); tX < width && tX + x < this.width; tX++)
                    this.__set_pixel__(tX + x, tY + y, color(tX, tY));
        if (this.__gain_map__)
            gain.redraw(this, this.__gain_map__, Math.max(0, x), Math.max(0, y), Math.min(this.width, x + width), Math.min(this.height, y + height), (_x, _y, S, _boost, out) => {
                out[0] = S[0];
                out[1] = S[1];
                out[2] = S[2];
            });
        return this;
    }
    __fast_box__(x, y, width, height, color) {
        const left = Math.max(0, x), top = Math.max(0, y);
        const right = Math.min(this.width, x + width), bottom = Math.min(this.height, y + height);
        if (right <= left || bottom <= top)
            return this;
        for (let xPos = left; xPos < right; xPos++)
            this.__view__.setUint32(4 * (xPos + top * this.width), color);
        const start = 4 * (left + top * this.width);
        const end = 4 * (right + top * this.width);
        for (let row = top + 1; row < bottom; row++)
            this.bitmap.copyWithin(4 * (left + row * this.width), start, end);
        return this;
    }
    drawCircle(x, y, radius, color) {
        x = ~~finite(x, 'x');
        y = ~~finite(y, 'y');
        radius = finite(radius, 'radius');
        if (typeof color !== 'function')
            color = checkColor(color);
        const cx = x + 0.5, cy = y + 0.5;
        for (let py = Math.max(0, Math.floor(cy - radius)); py < Math.min(this.height, Math.ceil(cy + radius)); py++) {
            for (let px = Math.max(0, Math.floor(cx - radius)); px < Math.min(this.width, Math.ceil(cx + radius)); px++) {
                const coverage = circleCoverage(px, py, cx, cy, radius);
                if (coverage <= 0)
                    continue;
                const value = typeof color === 'function' ? color(px - x + radius, py - y + radius) : color;
                if (coverage >= 1)
                    this.__set_pixel__(px, py, value);
                else
                    this.__blend_pixel__(px, py, value, coverage);
            }
        }
        const map = this.__gain_map__;
        if (map) {
            const oS = map.offsetSDR, oH = map.offsetHDR;
            gain.redraw(this, map, Math.max(0, Math.floor(cx - radius)), Math.max(0, Math.floor(cy - radius)), Math.min(this.width, Math.ceil(cx + radius)), Math.min(this.height, Math.ceil(cy + radius)), (px, py, S, boost, out) => {
                const coverage = Math.min(1, Math.max(0, circleCoverage(px, py, cx, cy, radius)));
                for (let c = 0; c < 3; c++)
                    out[c] = coverage * S[c] + (1 - coverage) * ((S[c] + oS[c]) * boost[c] - oH[c]);
            });
        }
        return this;
    }
    __blend_pixel__(x, y, color, amount) {
        const i = (y * this.width + x) * 4, b = this.bitmap;
        const sa = (color & 0xff) / 255 * amount, da = b[i + 3] / 255 * (1 - amount);
        const a = sa + da;
        if (a <= 0) {
            b[i] = b[i + 1] = b[i + 2] = b[i + 3] = 0;
            return;
        }
        b[i] = ((color >>> 24) * sa + b[i] * da) / a;
        b[i + 1] = ((color >> 16 & 0xff) * sa + b[i + 1] * da) / a;
        b[i + 2] = ((color >> 8 & 0xff) * sa + b[i + 2] * da) / a;
        b[i + 3] = a * 255;
    }
    cropCircle(maxOrOptions = false, featheringArgument = 0) {
        const { max = false, fit, size: givenSize, feathering = 0 } = typeof maxOrOptions === 'object' && maxOrOptions !== null
            ? maxOrOptions : { max: maxOrOptions, feathering: featheringArgument };
        const size = fit ?? givenSize ?? (max ? 'cover' : 'contain');
        finite(feathering, 'feathering');
        if (size !== 'contain' && size !== 'cover')
            throw new TypeError(`Invalid circle size: ${String(size)}`);
        const radius = (size === 'cover' ? Math.max : Math.min)(this.width, this.height) / 2;
        const cx = this.width / 2, cy = this.height / 2;
        const band = Math.min(1, Math.max(0, feathering)) * radius;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const alpha = 4 * (y * this.width + x) + 3;
                const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
                if (dx * dx + dy * dy <= (radius - Math.max(band, 1)) ** 2)
                    continue;
                const factor = band > 1
                    ? Math.min(1, Math.max(0, (radius - Math.hypot(dx, dy)) / band))
                    : circleCoverage(x, y, cx, cy, radius);
                if (factor < 1)
                    this.bitmap[alpha] *= factor;
            }
        }
        return this;
    }
    recolor(colorOrImage) {
        if (colorOrImage instanceof Image) {
            const colors = colorOrImage;
            if (colors.width !== this.width || colors.height !== this.height)
                throw new RangeError(`The image to take the colors from has to be ${this.width}x${this.height}, not ${colors.width}x${colors.height}`);
            if (this.__gain_map__)
                return this.__recolor__(image => image.recolor(image.width === colors.width && image.height === colors.height ? colors : colors.clone().resize(image.width, image.height)));
            const from = colors.bitmap, to = this.bitmap;
            for (let i = 0; i < to.length; i += 4) {
                to[i] = from[i];
                to[i + 1] = from[i + 1];
                to[i + 2] = from[i + 2];
            }
            return this;
        }
        const color = checkColor(colorOrImage);
        if (this.__gain_map__)
            return this.__recolor__(image => image.recolor(color));
        const r = color >>> 24, g = color >> 16 & 0xff, b = color >> 8 & 0xff;
        for (let i = 0; i < this.bitmap.length; i += 4) {
            this.bitmap[i] = r;
            this.bitmap[i + 1] = g;
            this.bitmap[i + 2] = b;
        }
        return this;
    }
    opacity(opacity, absoluteOrOptions = false) {
        const absolute = isOptions(absoluteOrOptions) ? absoluteOrOptions.absolute ?? false : absoluteOrOptions;
        opacity = finite(opacity, 'opacity value');
        if (opacity < 0)
            throw new RangeError('Invalid opacity value');
        this.__set_channel_value__(opacity, absolute, 3);
        return this;
    }
    red(factor, absoluteOrOptions = false) {
        if (this.__gain_map__)
            return this.__recolor__(image => image.red(factor, absoluteOrOptions));
        const absolute = isOptions(absoluteOrOptions) ? absoluteOrOptions.absolute ?? false : absoluteOrOptions;
        factor = finite(factor, 'red factor');
        if (factor < 0)
            throw new RangeError('Invalid red factor');
        this.__set_channel_value__(factor, absolute, 0);
        return this;
    }
    green(factor, absoluteOrOptions = false) {
        if (this.__gain_map__)
            return this.__recolor__(image => image.green(factor, absoluteOrOptions));
        const absolute = isOptions(absoluteOrOptions) ? absoluteOrOptions.absolute ?? false : absoluteOrOptions;
        factor = finite(factor, 'green factor');
        if (factor < 0)
            throw new RangeError('Invalid green factor');
        this.__set_channel_value__(factor, absolute, 1);
        return this;
    }
    blue(factor, absoluteOrOptions = false) {
        if (this.__gain_map__)
            return this.__recolor__(image => image.blue(factor, absoluteOrOptions));
        const absolute = isOptions(absoluteOrOptions) ? absoluteOrOptions.absolute ?? false : absoluteOrOptions;
        factor = finite(factor, 'blue factor');
        if (factor < 0)
            throw new RangeError('Invalid blue factor');
        this.__set_channel_value__(factor, absolute, 2);
        return this;
    }
    __set_channel_value__(value, absolute, offset) {
        for (let i = offset; i < this.bitmap.length; i += 4)
            this.bitmap[i] = value * (absolute ? 255 : this.bitmap[i]);
    }
    lightness(value, absoluteOrOptions = false) {
        if (this.__gain_map__)
            return this.__recolor__(image => image.lightness(value, absoluteOrOptions));
        const absolute = isOptions(absoluteOrOptions) ? absoluteOrOptions.absolute ?? false : absoluteOrOptions;
        value = finite(value, 'lightness value');
        if (value < 0)
            throw new RangeError('Invalid lightness value');
        return this.__map_hsla__(c => { c.l = value * (absolute ? 1 : c.l); });
    }
    saturation(value, absoluteOrOptions = false) {
        if (this.__gain_map__)
            return this.__recolor__(image => image.saturation(value, absoluteOrOptions), true);
        const absolute = isOptions(absoluteOrOptions) ? absoluteOrOptions.absolute ?? false : absoluteOrOptions;
        value = finite(value, 'saturation value');
        if (value < 0)
            throw new RangeError('Invalid saturation value');
        return this.__map_hsla__(c => { c.s = value * (absolute ? 1 : c.s); });
    }
    composite(source, xOrOptions = 0, yArgument = 0, optionsArgument = {}) {
        const options = isOptions(xOrOptions) ? xOrOptions : optionsArgument;
        const { opacity = 1, mode = 'normal' } = options;
        let x = isOptions(xOrOptions) ? xOrOptions.x ?? 0 : xOrOptions, y = isOptions(xOrOptions) ? xOrOptions.y ?? 0 : yArgument;
        x = finite(x, 'x') | 0;
        y = finite(y, 'y') | 0;
        if (isNaN(opacity) || opacity < 0 || opacity > 1)
            throw new RangeError('Invalid composite opacity');
        const blend = BLEND_MODES[mode];
        if (!blend || !Object.prototype.hasOwnProperty.call(BLEND_MODES, mode))
            throw new RangeError(`Invalid blend mode: ${mode}`);
        if (opacity === 0)
            return this;
        if (this.__gain_map__ || source.__gain_map__)
            return this.__composite_gain__(source, x, y, opacity, mode);
        if (mode !== 'normal')
            return this.__blend__(source, x, y, opacity, blend);
        const left = Math.max(0, x), top = Math.max(0, y);
        const right = Math.min(this.width, x + source.width), bottom = Math.min(this.height, y + source.height);
        const dst = this.bitmap, src = source.bitmap;
        for (let row = top; row < bottom; row++) {
            for (let column = left, s = 4 * ((row - y) * source.width + left - x), d = 4 * (row * this.width + left); column < right; column++, s += 4, d += 4) {
                const sa = src[s + 3];
                if (sa === 0)
                    continue;
                const da = dst[d + 3];
                if ((sa === 255 && opacity === 1) || da === 0) {
                    dst[d] = src[s];
                    dst[d + 1] = src[s + 1];
                    dst[d + 2] = src[s + 2];
                    dst[d + 3] = sa * opacity;
                    continue;
                }
                const fa = sa / 255 * opacity, ba = da / 255 * (1 - fa);
                const a = fa + ba;
                dst[d] = (src[s] * fa + dst[d] * ba) / a;
                dst[d + 1] = (src[s + 1] * fa + dst[d + 1] * ba) / a;
                dst[d + 2] = (src[s + 2] * fa + dst[d + 2] * ba) / a;
                dst[d + 3] = a * 255;
            }
        }
        return this;
    }
    __composite_gain__(source, x, y, opacity, mode) {
        const left = Math.max(0, x), top = Math.max(0, y);
        const right = Math.min(this.width, x + source.width), bottom = Math.min(this.height, y + source.height);
        if (right <= left || bottom <= top)
            return this;
        const before = this.__crop__(left, top, right - left, bottom - top).bitmap, beforeWidth = right - left;
        const ownMap = this.__gain_map__, sourceMap = source.__gain_map__;
        this.__gain_map__ = source.__gain_map__ = null;
        try {
            this.composite(source, x, y, { opacity, mode });
        }
        finally {
            this.__gain_map__ = ownMap;
            source.__gain_map__ = sourceMap;
        }
        const blend = mode !== 'normal';
        const map = this.__gain_map__ ??= gain.neutralMap(sourceMap, source.width, this.width, this.height);
        if (sourceMap)
            map.hdrCapacityMax = Math.max(map.hdrCapacityMax, sourceMap.hdrCapacityMax);
        const sample = gain.gainSampler(source);
        const sourceOS = sourceMap?.offsetSDR ?? [0, 0, 0], sourceOH = sourceMap?.offsetHDR ?? [0, 0, 0];
        const oS = map.offsetSDR, oH = map.offsetHDR;
        const src = source.bitmap, Gs = [0, 0, 0];
        let lastGain = NaN, lastPower = 1;
        gain.redraw(this, map, left, top, right, bottom, (px, py, S, boost, out) => {
            const s = 4 * ((py - y) * source.width + px - x), b = 4 * ((py - top) * beforeWidth + px - left);
            const as = src[s + 3] / 255 * opacity, ab = before[b + 3] / 255;
            const ao = as + ab * (1 - as);
            if (blend && ab === 1) {
                for (let c = 0; c < 3; c++)
                    out[c] = (S[c] + oS[c]) * boost[c] - oH[c];
                return;
            }
            if (ao <= 0) {
                out[0] = out[1] = out[2] = 0;
                return;
            }
            let sampled = false;
            for (let c = 0; c < 3; c++) {
                const Sd = gain.LINEAR[before[b + c]], Ss = gain.LINEAR[src[s + c]];
                const Hd = (Sd + oS[c]) * boost[c] - oH[c];
                const share = Math.abs(Ss - Sd) > 1e-4 ? Math.min(1, Math.max(0, (S[c] - Sd) / (Ss - Sd))) : as / ao;
                if (share === 0) {
                    out[c] = Hd;
                    continue;
                }
                let Hs = Ss;
                if (sample) {
                    if (!sampled) {
                        sample(px - x, py - y, Gs);
                        sampled = true;
                    }
                    if (Gs[c] !== lastGain) {
                        lastGain = Gs[c];
                        lastPower = 2 ** lastGain;
                    }
                    Hs = (Ss + sourceOS[c]) * lastPower - sourceOH[c];
                }
                out[c] = share * Hs + (1 - share) * Hd;
            }
        }, map.channels === 1 && (!sourceMap || sourceMap.channels === 1), Math.max(0, ...(sourceMap?.gainMapMax ?? [0])));
        return this;
    }
    __blend__(source, x, y, opacity, blend) {
        const left = Math.max(0, x), top = Math.max(0, y);
        const right = Math.min(this.width, x + source.width), bottom = Math.min(this.height, y + source.height);
        const dst = this.bitmap, src = source.bitmap;
        for (let row = top; row < bottom; row++) {
            for (let column = left; column < right; column++) {
                const s = 4 * ((row - y) * source.width + column - x);
                const as = src[s + 3] / 255 * opacity;
                if (as <= 0)
                    continue;
                const d = 4 * (row * this.width + column);
                const ab = dst[d + 3] / 255;
                const ao = as + ab * (1 - as);
                for (let c = 0; c < 3; c++) {
                    const cs = src[s + c] / 255, cb = dst[d + c] / 255;
                    const cr = (1 - ab) * cs + ab * blend(cb, cs);
                    dst[d + c] = (as * cr + ab * (1 - as) * cb) / ao * 255;
                }
                dst[d + 3] = ao * 255;
            }
        }
        return this;
    }
    invert() {
        if (this.__gain_map__)
            return this.__unboost__(image => image.invert());
        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4) {
            bitmap[i] = 255 - bitmap[i];
            bitmap[i + 1] = 255 - bitmap[i + 1];
            bitmap[i + 2] = 255 - bitmap[i + 2];
        }
        return this;
    }
    invertLightness() {
        if (this.__gain_map__)
            return this.__unboost__(image => image.invertLightness());
        return this.__map_hsla__(c => { c.l = 1 - c.l; });
    }
    invertValue() {
        if (this.__gain_map__)
            return this.__unboost__(image => image.invertValue());
        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4) {
            const max = Math.max(bitmap[i], bitmap[i + 1], bitmap[i + 2]);
            if (max === 0) {
                bitmap[i] = bitmap[i + 1] = bitmap[i + 2] = 255;
                continue;
            }
            const factor = (255 - max) / max;
            bitmap[i] *= factor;
            bitmap[i + 1] *= factor;
            bitmap[i + 2] *= factor;
        }
        return this;
    }
    hueShift(degrees) {
        if (this.__gain_map__)
            return this.__recolor__(image => image.hueShift(degrees), true);
        degrees = finite(degrees, 'hue shift');
        return this.__map_hsla__(c => { c.h += degrees / 360; });
    }
    __map_hsla__(map) {
        const bitmap = this.bitmap;
        const hsla = { h: 0, s: 0, l: 0, a: 0 };
        const pixels = new Uint32Array(bitmap.buffer, bitmap.byteOffset, bitmap.length >> 2);
        const keys = new Uint32Array(4096), values = new Uint32Array(4096);
        keys[0] = 1;
        for (let i = 0; i < bitmap.length; i += 4) {
            const color = pixels[i >> 2];
            const slot = Math.imul(color, 0x9e3779b1) >>> 20;
            if (keys[slot] === color) {
                pixels[i >> 2] = values[slot];
                continue;
            }
            const r = bitmap[i] / 255, g = bitmap[i + 1] / 255, b = bitmap[i + 2] / 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const l = (max + min) / 2;
            let h = 0, s = 0;
            if (max !== min) {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                if (max === r)
                    h = (g - b) / d + (g < b ? 6 : 0);
                else if (max === g)
                    h = (b - r) / d + 2;
                else
                    h = (r - g) / d + 4;
                h /= 6;
            }
            hsla.h = h;
            hsla.s = s;
            hsla.l = l;
            hsla.a = bitmap[i + 3] / 255;
            map(hsla);
            const nh = wrapHue(hsla.h);
            const ns = Math.min(1, Math.max(0, hsla.s));
            const nl = Math.min(1, Math.max(0, hsla.l));
            const na = Math.min(1, Math.max(0, hsla.a));
            if (ns === 0)
                bitmap[i] = bitmap[i + 1] = bitmap[i + 2] = Math.round(nl * 255);
            else {
                const q = nl < 0.5 ? nl * (1 + ns) : nl + ns - nl * ns;
                const p = 2 * nl - q;
                bitmap[i] = Math.round(hue2rgb(p, q, nh + 1 / 3) * 255);
                bitmap[i + 1] = Math.round(hue2rgb(p, q, nh) * 255);
                bitmap[i + 2] = Math.round(hue2rgb(p, q, nh - 1 / 3) * 255);
            }
            bitmap[i + 3] = Math.round(na * 255);
            keys[slot] = color;
            values[slot] = pixels[i >> 2];
        }
        return this;
    }
    blur(radius) {
        if (!Number.isFinite(radius) || radius < 0)
            throw new RangeError('Invalid blur radius');
        const map = this.__gain_map__;
        if (map && radius * map.width / this.width >= 0.5)
            map.image = map.image.clone().blur(radius * map.width / this.width);
        if (boxBlurRGBA(this.bitmap, this.width, this.height, radius))
            return this;
        const pixels = premultiply(this.bitmap);
        gaussianBlur(pixels, this.width, this.height, radius);
        unpremultiply(pixels, this.bitmap);
        return this;
    }
    quantize(options = {}) {
        if (typeof options !== 'object' || options === null)
            throw new TypeError('quantize takes an options object');
        const { colors, palette, dither = 'none', ditherStrength = 1 } = options;
        if (colors !== undefined && palette !== undefined)
            throw new TypeError('quantize takes colors or palette, not both');
        let fixed = null, count = 256;
        if (palette !== undefined) {
            if (!Array.isArray(palette))
                throw new TypeError('palette has to be an array of colors');
            if (palette.length < 1 || palette.length > 256)
                throw new RangeError(`palette needs 1 to 256 colors, not ${palette.length}`);
            const packed = new Uint8Array(palette.length * 3);
            palette.forEach((color, i) => {
                const value = checkColor(color, 'palette color');
                if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
                    throw new RangeError(`Invalid palette color: ${color}`);
                packed[i * 3] = value >>> 24;
                packed[i * 3 + 1] = value >>> 16 & 255;
                packed[i * 3 + 2] = value >>> 8 & 255;
            });
            fixed = packed;
        }
        else if (colors !== undefined) {
            count = finite(colors, 'colors');
            if (!Number.isInteger(count) || count < 2 || count > 256)
                throw new RangeError(`colors must be an integer from 2 to 256, not ${colors}`);
        }
        if (!DITHER_METHODS.includes(dither))
            throw new TypeError(`dither must be one of ${DITHER_METHODS.map(name => `'${name}'`).join(', ')}, not ${String(dither)}`);
        const strength = finite(ditherStrength, 'ditherStrength');
        if (strength < 0 || strength > 1)
            throw new RangeError(`ditherStrength must be 0-1, not ${ditherStrength}`);
        const reduce = (image) => {
            const bytes = image.__bytes__();
            const table = fixed ?? quantize.buildPalette(bytes, count, 1);
            quantize.applyPalette(bytes, image.width, image.height, table, dither, strength);
        };
        if (this.__gain_map__)
            return this.__unboost__(reduce);
        reduce(this);
        return this;
    }
    colorMatrix(matrix) {
        if (matrix === null || typeof matrix !== 'object' || (matrix.length !== 9 && matrix.length !== 20))
            throw new RangeError('A color matrix has 9 or 20 values');
        const m = new Float64Array(20);
        const value = (v) => finite(typeof v === 'number' ? v : NaN, 'color matrix value');
        if (matrix.length === 20)
            for (let i = 0; i < 20; i++)
                m[i] = value(matrix[i]);
        else
            for (let row = 0; row < 3; row++)
                for (let column = 0; column < 3; column++)
                    m[row * 5 + column] = value(matrix[row * 3 + column]);
        if (matrix.length === 9)
            m[18] = 1;
        if (this.__gain_map__)
            return this.__recolor__(image => image.colorMatrix(m));
        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4) {
            const r = bitmap[i], g = bitmap[i + 1], b = bitmap[i + 2], a = bitmap[i + 3];
            bitmap[i] = m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4] * 255;
            bitmap[i + 1] = m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9] * 255;
            bitmap[i + 2] = m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14] * 255;
            bitmap[i + 3] = m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19] * 255;
        }
        return this;
    }
    transform(matrix, options = {}) {
        if (matrix === null || typeof matrix !== 'object' || matrix.length !== 6)
            throw new RangeError('A transform has 6 values: [a, b, c, d, e, f]');
        const values = Array.from({ length: 6 }, (_, i) => finite(typeof matrix[i] === 'number' ? matrix[i] : NaN, 'transform value'));
        if (typeof options !== 'object' || options === null)
            throw new TypeError('transform takes an options object');
        const { origin = {}, expand = true, mode = 'bilinear' } = options;
        if (!TRANSFORM_MODES.includes(mode))
            throw new TypeError(`transform mode must be one of ${TRANSFORM_MODES.map(name => `'${name}'`).join(', ')}, not ${String(mode)}`);
        const { x: pivotX = this.width / 2, y: pivotY = this.height / 2 } = origin;
        finite(pivotX, 'origin x');
        finite(pivotY, 'origin y');
        const around = multiply(multiply([1, 0, 0, 1, pivotX, pivotY], values), [1, 0, 0, 1, -pivotX, -pivotY]);
        const inverse = invert(around);
        if (!inverse)
            throw new RangeError('The transform has to be invertible: it can\'t flatten the image');
        const { width, height } = this;
        let left = 0, top = 0, outWidth = width, outHeight = height;
        if (expand) {
            const xs = [], ys = [];
            for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]]) {
                xs.push(around[0] * x + around[2] * y + around[4]);
                ys.push(around[1] * x + around[3] * y + around[5]);
            }
            const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
            outWidth = Math.max(1, Math.round(maxX - minX));
            outHeight = Math.max(1, Math.round(maxY - minY));
            left = minX - (outWidth - (maxX - minX)) / 2;
            top = minY - (outHeight - (maxY - minY)) / 2;
            const room = this.__room__();
            if (left < -room.left) {
                left = -room.left;
                outWidth = Math.max(1, Math.round(maxX - left));
            }
            if (top < -room.top) {
                top = -room.top;
                outHeight = Math.max(1, Math.round(maxY - top));
            }
            if (outWidth * outHeight > MAX_PIXELS)
                throw new RangeError(`The transformed image would have ${outWidth}x${outHeight} pixels, more than the ${MAX_PIXELS} allowed`);
        }
        const out = new Image(outWidth, outHeight);
        sampleAffine(this.bitmap, width, height, out.bitmap, outWidth, outHeight, inverse, left, top, mode);
        const scale = Math.sqrt(Math.abs(around[0] * around[3] - around[1] * around[2]));
        this.__gain_map__?.__transform__(width, height, outWidth, outHeight, (X, Y) => {
            const x = X + left, y = Y + top;
            return [inverse[0] * x + inverse[2] * y + inverse[4], inverse[1] * x + inverse[3] * y + inverse[5]];
        }, scale);
        this.__apply__(out);
        if (left || top)
            this.__grown__(-Math.round(left), -Math.round(top));
        return this;
    }
    dropShadow(options = {}) {
        const { x = 0, y = 0, blur = 0, spread = 0, color = 0x00000080, expand = true } = options;
        finite(x, 'x');
        finite(y, 'y');
        if (finite(blur, 'blur') < 0)
            throw new RangeError('Invalid blur radius');
        if (finite(spread, 'spread') < 0)
            throw new RangeError('Invalid spread');
        const [r, g, b, a] = Colors.toRGBA(checkColor(color));
        const reach = spread + 3 * blur, margin = Math.ceil(reach) + 1;
        const layer = this.__shape_layer__(margin);
        const width = layer.width;
        const coverage = new Uint8Array(width * layer.height);
        for (let i = 0; i < coverage.length; i++)
            coverage[i] = layer.bitmap[i * 4 + 3];
        const grown = spread > 0 ? outline(coverage, width, layer.height, spread) : null;
        const bitmap = layer.bitmap;
        for (let i = 0; i < coverage.length; i++) {
            bitmap[i * 4] = r;
            bitmap[i * 4 + 1] = g;
            bitmap[i * 4 + 2] = b;
            bitmap[i * 4 + 3] = (grown ? grown[i] * 255 : coverage[i]) * a / 255;
        }
        if (blur > 0) {
            layer.blur(blur);
            for (let i = 0; i < coverage.length; i++) {
                if (!bitmap[i * 4 + 3])
                    continue;
                bitmap[i * 4] = r;
                bitmap[i * 4 + 1] = g;
                bitmap[i * 4 + 2] = b;
            }
        }
        const room = this.__room__();
        return this.__under__(layer, x - margin, y - margin, expand ? {
            left: Math.min(room.left, Math.max(0, Math.ceil(reach - x))),
            top: Math.min(room.top, Math.max(0, Math.ceil(reach - y))),
            right: Math.max(0, Math.ceil(reach + x)),
            bottom: Math.max(0, Math.ceil(reach + y))
        } : { left: 0, top: 0, right: 0, bottom: 0 });
    }
    outline(options = {}) {
        const { width = 1, color = 0x000000ff, expand = true } = options;
        if (finite(width, 'outline width') < 0)
            throw new RangeError('Invalid outline width');
        const [r, g, b, a] = Colors.toRGBA(checkColor(color));
        if (width === 0)
            return this;
        const margin = Math.ceil(width) + 1;
        const layer = this.__shape_layer__(margin);
        const coverage = new Uint8Array(layer.width * layer.height);
        for (let i = 0; i < coverage.length; i++)
            coverage[i] = layer.bitmap[i * 4 + 3];
        const stroke = outline(coverage, layer.width, layer.height, width);
        const bitmap = layer.bitmap;
        for (let i = 0; i < coverage.length; i++) {
            bitmap[i * 4] = r;
            bitmap[i * 4 + 1] = g;
            bitmap[i * 4 + 2] = b;
            bitmap[i * 4 + 3] = stroke[i] * (1 - coverage[i] / 255) * a;
        }
        const room = this.__room__(), grow = Math.ceil(width);
        return this.__under__(layer, -margin, -margin, expand
            ? { left: Math.min(room.left, grow), top: Math.min(room.top, grow), right: grow, bottom: grow }
            : { left: 0, top: 0, right: 0, bottom: 0 });
    }
    __shape_layer__(margin) {
        const layer = new Image(this.width + 2 * margin, this.height + 2 * margin);
        for (let y = 0; y < this.height; y++)
            for (let x = 0; x < this.width; x++)
                layer.bitmap[((y + margin) * layer.width + x + margin) * 4 + 3] = this.bitmap[(y * this.width + x) * 4 + 3];
        return layer;
    }
    __under__(layer, layerX, layerY, grow) {
        const { left, top, right, bottom } = grow;
        const width = this.width + left + right, height = this.height + top + bottom;
        const result = new Image(width, height);
        result.composite(layer, { x: layerX + left, y: layerY + top });
        const map = this.__gain_map__;
        this.__gain_map__ = null;
        try {
            result.composite(this, { x: left, y: top });
        }
        finally {
            this.__gain_map__ = map;
        }
        map?.__transform__(this.width, this.height, width, height, (X, Y) => [X - left, Y - top]);
        this.__apply__(result);
        if (left || top)
            this.__grown__(left, top);
        return this;
    }
    __room__() {
        return { left: Infinity, top: Infinity };
    }
    __grown__(_left, _top) {
    }
    sharpen(amountOrOptions = 1, radiusArgument = 1) {
        const { amount = 1, radius = 1 } = isOptions(amountOrOptions) ? amountOrOptions : { amount: amountOrOptions, radius: radiusArgument };
        if (!Number.isFinite(amount) || amount < 0)
            throw new RangeError('Invalid sharpen amount');
        if (!Number.isFinite(radius) || radius <= 0)
            throw new RangeError('Invalid sharpen radius');
        const blurred = premultiply(this.bitmap);
        gaussianBlur(blurred, this.width, this.height, radius);
        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4) {
            const a = blurred[i + 3];
            if (a < 0.5 || bitmap[i + 3] === 0)
                continue;
            const f = 255 / a;
            bitmap[i] += amount * (bitmap[i] - blurred[i] * f);
            bitmap[i + 1] += amount * (bitmap[i + 1] - blurred[i + 1] * f);
            bitmap[i + 2] += amount * (bitmap[i + 2] - blurred[i + 2] * f);
        }
        return this;
    }
    brightness(factor) {
        if (this.__gain_map__)
            return this.__recolor__(image => image.brightness(factor), false, v => v * factor);
        factor = finite(factor, 'brightness factor');
        if (factor < 0)
            throw new RangeError('Invalid brightness factor');
        return this.__map_channels__(v => v * factor);
    }
    contrast(factor) {
        if (this.__gain_map__)
            return this.__recolor__(image => image.contrast(factor), false, v => (v - 0.5) * factor + 0.5);
        factor = finite(factor, 'contrast factor');
        if (factor < 0)
            throw new RangeError('Invalid contrast factor');
        return this.__map_channels__(v => (v - 127.5) * factor + 127.5);
    }
    gamma(gamma) {
        if (this.__gain_map__)
            return this.__recolor__(image => image.gamma(gamma), false, v => Math.max(0, v) ** (1 / gamma));
        gamma = finite(gamma, 'gamma');
        if (gamma <= 0)
            throw new RangeError('Invalid gamma');
        return this.__map_channels__(v => 255 * (v / 255) ** (1 / gamma));
    }
    greyscale() {
        if (this.__gain_map__)
            return this.__recolor__(image => image.greyscale(), true);
        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4)
            bitmap[i] = bitmap[i + 1] = bitmap[i + 2] = bitmap[i] * 19595 + bitmap[i + 1] * 38470 + bitmap[i + 2] * 7471 + 0x8000 >> 16;
        return this;
    }
    sepia() {
        if (this.__gain_map__)
            return this.__recolor__(image => image.sepia(), true);
        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4) {
            const r = bitmap[i], g = bitmap[i + 1], b = bitmap[i + 2];
            bitmap[i] = 0.393 * r + 0.769 * g + 0.189 * b;
            bitmap[i + 1] = 0.349 * r + 0.686 * g + 0.168 * b;
            bitmap[i + 2] = 0.272 * r + 0.534 * g + 0.131 * b;
        }
        return this;
    }
    colorToAlpha(colorOrOptions, optionsArgument = {}) {
        const { color: colorOption, transparencyThreshold = 0, opacityThreshold = 1 } = isOptions(colorOrOptions) ? colorOrOptions : { ...optionsArgument, color: colorOrOptions ?? optionsArgument.color };
        let color = colorOption;
        if (!(transparencyThreshold >= 0 && opacityThreshold <= 1 && transparencyThreshold < opacityThreshold))
            throw new RangeError('Invalid thresholds, they have to satisfy 0 <= transparencyThreshold < opacityThreshold <= 1');
        const bitmap = this.bitmap;
        if (color !== undefined)
            color = checkColor(color);
        const c = color === undefined ? [bitmap[0], bitmap[1], bitmap[2]] : [color >>> 24, color >> 16 & 255, color >> 8 & 255];
        for (let i = 0; i < bitmap.length; i += 4) {
            let distance = 0;
            for (let k = 0; k < 3; k++) {
                const d = bitmap[i + k] - c[k];
                const a = d > 0 ? d / (255 - c[k]) : d < 0 ? -d / c[k] : 0;
                if (a > distance)
                    distance = a;
            }
            const alpha = distance <= transparencyThreshold ? 0 : distance >= opacityThreshold ? 1
                : (distance - transparencyThreshold) / (opacityThreshold - transparencyThreshold);
            if (alpha > 0)
                for (let k = 0; k < 3; k++)
                    bitmap[i + k] = Math.round((bitmap[i + k] - c[k]) / alpha + c[k]);
            bitmap[i + 3] = Math.round(bitmap[i + 3] * alpha);
        }
        return this;
    }
    __map_channels__(map) {
        const lut = new Uint8ClampedArray(256);
        for (let v = 0; v < 256; v++)
            lut[v] = map(v);
        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4) {
            bitmap[i] = lut[bitmap[i]];
            bitmap[i + 1] = lut[bitmap[i + 1]];
            bitmap[i + 2] = lut[bitmap[i + 2]];
        }
        return this;
    }
    averageColor() {
        let r = 0, g = 0, b = 0, weight = 0;
        for (let i = 0; i < this.bitmap.length; i += 4) {
            const a = this.bitmap[i + 3];
            r += this.bitmap[i] * a;
            g += this.bitmap[i + 1] * a;
            b += this.bitmap[i + 2] * a;
            weight += a;
        }
        if (!weight)
            return Colors.fromRGBA(0, 0, 0, 0xff);
        return Colors.fromRGBA(Math.round(r / weight), Math.round(g / weight), Math.round(b / weight), 0xff);
    }
    dominantColor(ignoreBlackOrOptions = true, ignoreWhiteArgument = true, thresholdArgument = 0xf) {
        const { ignoreBlack = true, ignoreWhite = true, threshold: bwThreshold = 0xf } = typeof ignoreBlackOrOptions === 'object' && ignoreBlackOrOptions !== null
            ? ignoreBlackOrOptions : { ignoreBlack: ignoreBlackOrOptions, ignoreWhite: ignoreWhiteArgument, threshold: thresholdArgument };
        const threshold = Math.min(64, Math.max(0, finite(bwThreshold, 'threshold'))) * 4;
        const pixels = this.__bytes__();
        const color = quantize.dominantColor(pixels, (r, g, b) => !(ignoreBlack && Math.max(r, g, b) < threshold) && !(ignoreWhite && Math.min(r, g, b) > 255 - threshold))
            || quantize.dominantColor(pixels, () => true);
        return color ? Colors.fromRGB(...color) : Colors.fromRGBA(0, 0, 0, 0xff);
    }
    rotate(angle, resizeOrOptions = true) {
        const { resize = true, fast = true } = typeof resizeOrOptions === 'object' && resizeOrOptions !== null ? resizeOrOptions : { resize: resizeOrOptions };
        angle = ((finite(angle, 'angle') % 360) + 360) % 360;
        if (angle === 0)
            return this;
        const { width, height } = this;
        const src = this.__u32__;
        const rotateGainMap = (outWidth, outHeight) => {
            const rad = angle * Math.PI / 180, sin = Math.sin(rad), cos = Math.cos(rad);
            this.__gain_map__?.__transform__(width, height, outWidth, outHeight, (X, Y) => {
                const dx = X - outWidth / 2, dy = Y - outHeight / 2;
                return [dx * cos - dy * sin + width / 2, dx * sin + dy * cos + height / 2];
            });
        };
        if (angle === 90 || angle === 180 || angle === 270) {
            const out = new Image(angle === 180 ? width : height, angle === 180 ? height : width);
            const dst = out.__u32__;
            for (let y = 0; y < height; y++)
                for (let x = 0; x < width; x++) {
                    const i = src[y * width + x];
                    if (angle === 90)
                        dst[(width - 1 - x) * height + y] = i;
                    else if (angle === 180)
                        dst[(height - 1 - y) * width + width - 1 - x] = i;
                    else
                        dst[x * height + height - 1 - y] = i;
                }
            rotateGainMap(out.width, out.height);
            return this.__apply__(out);
        }
        const rad = angle * Math.PI / 180;
        const sin = Math.sin(rad), cos = Math.cos(rad);
        const outWidth = resize ? Math.round(Math.abs(width * cos) + Math.abs(height * sin)) : width;
        const outHeight = resize ? Math.round(Math.abs(width * sin) + Math.abs(height * cos)) : height;
        const out = new Image(outWidth, outHeight);
        rotateGainMap(outWidth, outHeight);
        if (fast && rotateBilinear(this.bitmap, width, height, out.bitmap, outWidth, outHeight, sin, cos))
            return this.__apply__(out);
        const s8 = this.bitmap, d8 = out.bitmap;
        for (let oy = 0; oy < outHeight; oy++) {
            for (let ox = 0; ox < outWidth; ox++) {
                const dx = ox + 0.5 - outWidth / 2, dy = oy + 0.5 - outHeight / 2;
                const sx = dx * cos - dy * sin + width / 2 - 0.5;
                const sy = dx * sin + dy * cos + height / 2 - 0.5;
                const x0 = Math.floor(sx), y0 = Math.floor(sy);
                if (x0 < -1 || y0 < -1 || x0 >= width || y0 >= height)
                    continue;
                const fx = sx - x0, fy = sy - y0;
                const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
                let r = 0, g = 0, b = 0, a = 0;
                const left = x0 >= 0, right = x0 + 1 < width, top = y0 >= 0, bottom = y0 + 1 < height;
                let i = 4 * (y0 * width + x0);
                if (top && left) {
                    const wa = w00 * s8[i + 3];
                    r += wa * s8[i];
                    g += wa * s8[i + 1];
                    b += wa * s8[i + 2];
                    a += wa;
                }
                if (top && right) {
                    const wa = w10 * s8[i + 7];
                    r += wa * s8[i + 4];
                    g += wa * s8[i + 5];
                    b += wa * s8[i + 6];
                    a += wa;
                }
                i += 4 * width;
                if (bottom && left) {
                    const wa = w01 * s8[i + 3];
                    r += wa * s8[i];
                    g += wa * s8[i + 1];
                    b += wa * s8[i + 2];
                    a += wa;
                }
                if (bottom && right) {
                    const wa = w11 * s8[i + 7];
                    r += wa * s8[i + 4];
                    g += wa * s8[i + 5];
                    b += wa * s8[i + 6];
                    a += wa;
                }
                if (a <= 0)
                    continue;
                const o = 4 * (oy * outWidth + ox);
                d8[o] = r / a;
                d8[o + 1] = g / a;
                d8[o + 2] = b / a;
                d8[o + 3] = a;
            }
        }
        return this.__apply__(out);
    }
    flip(direction) {
        const u32 = this.__u32__;
        const { width, height } = this;
        if (direction === 'horizontal') {
            for (let y = 0; y < height; y++)
                u32.subarray(y * width, (y + 1) * width).reverse();
        }
        else if (direction === 'vertical') {
            for (let y = 0; y < height >> 1; y++) {
                const top = u32.slice(y * width, (y + 1) * width);
                u32.copyWithin(y * width, (height - 1 - y) * width, (height - y) * width);
                u32.set(top, (height - 1 - y) * width);
            }
        }
        else
            throw new RangeError('Invalid flip direction');
        this.__gain_map__?.__transform__(width, height, width, height, direction === 'horizontal' ? (X, Y) => [width - X, Y] : (X, Y) => [X, height - Y]);
        return this;
    }
    __bytes__() {
        return new Uint8Array(this.bitmap.buffer, this.bitmap.byteOffset, this.bitmap.byteLength);
    }
    __unboost__(apply) {
        const map = this.__gain_map__;
        this.__gain_map__ = null;
        try {
            apply(this);
        }
        finally {
            this.__gain_map__ = gain.neutralMap(map, this.width, this.width, this.height);
        }
        return this;
    }
    __recolor__(apply, chromaOnly = false, exact) {
        const map = this.__gain_map__;
        this.__gain_map__ = null;
        try {
            if (chromaOnly && map.channels === 1) {
                apply(this);
                return this;
            }
            const before = this.__resize__(map.width, map.height);
            apply(this);
            gain.recolor(map, before, apply, exact);
            return this;
        }
        finally {
            this.__gain_map__ = map;
        }
    }
    __apply__(image) {
        this.__width__ = image.__width__;
        this.__height__ = image.__height__;
        this.__bitmap__ = image.__bitmap__;
        this.__view__ = image.__view__;
        this.__u32__ = image.__u32__;
        return this;
    }
    roundCorners(radiusOrOptions) {
        let radius = (isOptions(radiusOrOptions) ? radiusOrOptions.radius : radiusOrOptions) ?? Math.min(this.width, this.height) / 4;
        radius = finite(radius, 'radius');
        radius = Math.max(0, Math.min(radius, this.width / 2, this.height / 2));
        const size = Math.ceil(radius);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const coverage = pixelCoverage(x, y, (sx, sy) => sx >= radius || sy >= radius || (sx - radius) ** 2 + (sy - radius) ** 2 <= radius * radius);
                if (coverage >= 1)
                    continue;
                const corners = new Set([[x, y], [this.width - 1 - x, y], [x, this.height - 1 - y], [this.width - 1 - x, this.height - 1 - y]].map(([px, py]) => py * this.width + px));
                for (const pixel of corners)
                    this.bitmap[pixel * 4 + 3] *= coverage;
            }
        }
        return this;
    }
    fisheye(strengthOrOptions) {
        const strength = finite((isOptions(strengthOrOptions) ? strengthOrOptions.strength : strengthOrOptions) ?? 2, 'strength');
        const r = new Image(this.width, this.height);
        const w = this.width;
        const h = this.height;
        const tu32 = this.__u32__;
        const ru32 = r.__u32__;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const xco = (x + 0.5) / w - 0.5;
                const yco = (y + 0.5) / h - 0.5;
                const dfc = Math.sqrt(xco ** 2 + yco ** 2);
                if (dfc === 0) {
                    ru32[y * w + x] = tu32[y * w + x];
                    continue;
                }
                const dis = 2 * dfc ** strength;
                const nx = Math.floor((dis * xco / dfc + 0.5) * w);
                const ny = Math.floor((dis * yco / dfc + 0.5) * h);
                if (nx < 0 || nx >= w || ny < 0 || ny >= h)
                    continue;
                ru32[y * w + x] = tu32[ny * w + nx];
            }
        }
        this.__gain_map__?.__transform__(w, h, w, h, (X, Y) => {
            const xco = X / w - 0.5, yco = Y / h - 0.5, dfc = Math.sqrt(xco ** 2 + yco ** 2);
            if (dfc === 0)
                return [X, Y];
            const dis = 2 * dfc ** strength;
            return [(dis * xco / dfc + 0.5) * w, (dis * yco / dfc + 0.5) * h];
        });
        return this.__apply__(r);
    }
    async encodePNG(compressionOrOptions = 4, metadataArgument = {}) {
        let compression = 4, metadata = metadataArgument;
        if (!isOptions(compressionOrOptions))
            compression = compressionOrOptions;
        else if ('compression' in compressionOrOptions || 'metadata' in compressionOrOptions)
            ({ compression = 4, metadata = {} } = compressionOrOptions);
        else
            metadata = compressionOrOptions;
        return png.encodeRGBA(this.__bytes__(), this.width, this.height, compressionLevel(compression), pngText(resolveMetadata(metadata)));
    }
    encode(compressionOrOptions, metadata) {
        return this.encodePNG(compressionOrOptions, metadata);
    }
    async encodeJPEG(qualityOrOptions = 90) {
        const { quality = 90, metadata = {}, gainMap: gainMapOption = true } = isOptions(qualityOrOptions) ? qualityOrOptions : { quality: qualityOrOptions };
        const m = resolveMetadata(metadata);
        const base = { exif: exifData(m), comment: m.comment ? utf8(m.comment) : undefined };
        const gainMap = this.__gain_map__;
        if (!gainMap || gainMapOption === false)
            return jpeg.encode(this.__bytes__(), this.width, this.height, finite(quality, 'quality'), base);
        const { quality: mapQuality, scale } = typeof gainMapOption === 'object' && gainMapOption !== null ? gainMapOption : {};
        let width, height;
        if (scale !== undefined) {
            const s = finite(scale, 'gain map scale');
            if (!(s > 0 && s <= 1))
                throw new RangeError(`The gain map scale must be above 0 and at most 1, not ${s}`);
            width = Math.max(1, Math.round(this.width * s));
            height = Math.max(1, Math.round(this.height * s));
        }
        const params = gainMap.__params__();
        const map = gainMapCodec.mapWithMetadata(gainMap.__body__(mapQuality === undefined ? undefined : Math.max(1, checkQuality(mapQuality, 'gain map quality')), width, height), params);
        const primary = jpeg.encode(this.__bytes__(), this.width, this.height, finite(quality, 'quality'), { ...base, segments: gainMapCodec.primarySegments(map.length) });
        return gainMapCodec.finish(primary, map);
    }
    async encodeWebP({ quality, effort = 2, sharpYuv = false, alphaQuality = 100, threads = defaultThreads(), metadata = {} } = {}) {
        checkThreads(threads);
        const exif = exifData(resolveMetadata(metadata));
        const lossy = webp.lossyOptions(quality, effort, sharpYuv, alphaQuality);
        if (!lossy)
            return webp.encode(this.__bytes__(), this.width, this.height, exif, threads, effort);
        return webp.encodeLossy(this.__bytes__(), this.width, this.height, lossy, exif);
    }
    async encodeTGA({ metadata = {} } = {}) {
        const { author, comment, creationTime: time, software } = resolveMetadata(metadata);
        return tga.encode(this.__bytes__(), this.width, this.height, { author, comment, time, software });
    }
    async encodeBMP() {
        return bmp.encode(this.__bytes__(), this.width, this.height);
    }
    async encodeQOI() {
        return qoi.encode(this.__bytes__(), this.width, this.height);
    }
    async encodeAVIF({ quality = 60, alphaQuality = 100, subsampling = '4:4:4', effort = 1, threads = defaultThreads(), metadata = {}, gainMap = true } = {}) {
        checkEffort(effort, 2);
        checkThreads(threads);
        if (subsampling !== '4:4:4' && subsampling !== '4:2:0')
            throw new TypeError(`subsampling must be '4:4:4' or '4:2:0', not ${String(subsampling)}`);
        const exif = exifData(resolveMetadata(metadata));
        return avifEnc.encode(this.__bytes__(), this.width, this.height, {
            quality: checkQuality(quality), alphaQuality: checkQuality(alphaQuality, 'alphaQuality'), subsampling, effort, exif, threads, gainMap: this.__gain_map_pixels__(gainMap)
        });
    }
    __gain_map_pixels__(option) {
        const gainMap = this.__gain_map__;
        if (!gainMap || option === false)
            return undefined;
        const { quality = 90, scale } = typeof option === 'object' && option !== null ? option : {};
        const mapQuality = Math.max(1, checkQuality(quality, 'gain map quality'));
        let map = gainMap.image;
        if (scale !== undefined) {
            const s = finite(scale, 'gain map scale');
            if (!(s > 0 && s <= 1))
                throw new RangeError(`The gain map scale must be above 0 and at most 1, not ${s}`);
            const width = Math.max(1, Math.round(this.width * s)), height = Math.max(1, Math.round(this.height * s));
            if (width !== map.width || height !== map.height)
                map = map.clone().resize(width, height);
        }
        return { pixels: map.__bytes__(), width: map.width, height: map.height, params: gainMap.__params__(), quality: mapQuality };
    }
    async encodeJXL({ quality, effort = 1, threads = defaultThreads(), metadata = {}, gainMap = true } = {}) {
        checkEffort(effort, 2);
        checkThreads(threads);
        const distanceOf = (q) => q >= 100 ? 0 : q >= 30 ? 0.1 + (100 - q) * 0.09 : 53 / 3000 * q * q - 23 / 20 * q + 25;
        const distance = quality === undefined ? 0 : distanceOf(checkQuality(quality));
        const map = this.__gain_map_pixels__(gainMap);
        return jxl.encode(this.__bytes__(), this.width, this.height, exifData(resolveMetadata(metadata)), distance, effort, threads, map && { ...map, distance: distanceOf(map.quality) });
    }
    async encodePNM() {
        return netpbm.encode(this.__bytes__(), this.width, this.height);
    }
    static async decode(input, options = {}) {
        const { applyOrientation = true, applyColorProfile = true, maxPixels = MAX_PIXELS, toneMapping = 'reinhard', threads = defaultThreads(), gainMap = true } = options;
        checkThreads(threads);
        if (!(Number(maxPixels) > 0))
            throw new RangeError(`maxPixels must be a positive number, not ${maxPixels}`);
        if (toneMapping !== 'reinhard' && toneMapping !== 'clamp')
            throw new TypeError(`toneMapping must be 'reinhard' or 'clamp', not ${String(toneMapping)}`);
        const data = view(input);
        const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const decoded = await decoding(() => {
            if (ImageType.isPNG(dataView))
                return png.decode(data, maxPixels);
            if (ImageType.isJPEG(dataView))
                return jpeg.decode(data, { maxPixels });
            if (ImageType.isTIFF(dataView))
                return tiff.decode(data, maxPixels);
            if (ImageType.isWebP(dataView)) {
                if (webp.isAnimated(data))
                    throw new Error('Animated WebPs have to be decoded with Animation.decode()');
                return webp.decode(data, maxPixels);
            }
            const bitmap = async (decoded) => {
                if (!('embedded' in decoded))
                    return decoded;
                const { width, height, pixels } = decoded.embedded === 'png' ? await png.decode(decoded.data, maxPixels) : jpeg.decode(decoded.data, { maxPixels });
                return { width, height, pixels };
            };
            if (ImageType.isAVIF(dataView))
                return avif.decode(data, maxPixels, toneMapping, threads, gainMap);
            if (ImageType.isJXL(dataView))
                return jxl.decode(data, maxPixels, toneMapping, threads, gainMap);
            if (ImageType.isBMP(dataView))
                return bitmap(bmp.decode(data, maxPixels));
            if (ImageType.isICO(dataView))
                return bitmap(ico.decode(data, maxPixels));
            if (ImageType.isQOI(dataView))
                return qoi.decode(data, maxPixels);
            if (ImageType.isPNM(dataView))
                return netpbm.decode(data, maxPixels, toneMapping);
            if (ImageType.isHDR(dataView))
                return hdr.decode(data, maxPixels, toneMapping);
            if (ImageType.isTGA(dataView))
                return tga.decode(data, maxPixels);
            if (ImageType.isGIF(dataView))
                throw new Error('GIFs have to be decoded with Animation.decode() (or decode(), which returns an image or an animation)');
            throw new Error('Unsupported image type');
        });
        if (applyColorProfile) {
            const { icc, cicp, colorSpace } = decoded;
            (icc ? profileTransform(icc) : cicp ? cicpTransform(...cicp) : colorSpace ? colorSpaceTransform(colorSpace.xy, colorSpace.curve) : null)?.(decoded.pixels);
        }
        const image = new Image(decoded.width, decoded.height);
        image.bitmap = decoded.pixels;
        if (gainMap && ImageType.isJPEG(dataView)) {
            try {
                const found = gainMapCodec.find(data);
                const size = found && gainMapCodec.dimensions(found.map);
                if (found && size && size.width * size.height <= maxPixels)
                    image.__gain_map__ = GainMap.__from_jpeg__(found.map, found.params, found.apple);
            }
            catch {
                image.__gain_map__ = null;
            }
        }
        if (decoded.gainMap) {
            const { width, height, pixels, params } = decoded.gainMap;
            const map = new Image(width, height);
            map.bitmap = pixels;
            image.__gain_map__ = GainMap.__from_pixels__(map, params);
        }
        if (applyOrientation && decoded.orientation && decoded.orientation > 1) {
            image.__orient__(decoded.orientation);
            const map = image.__gain_map__;
            if (map) {
                try {
                    map.image = map.image.__orient__(decoded.orientation);
                }
                catch {
                    image.__gain_map__ = null;
                }
            }
        }
        return image;
    }
    __orient__(orientation) {
        if (orientation <= 1 || orientation > 8)
            return this;
        const w = this.width, h = this.height;
        const swap = orientation >= 5;
        const out = new Image(swap ? h : w, swap ? w : h);
        const src = this.__u32__, dst = out.__u32__;
        const ow = out.width, oh = out.height;
        for (let Y = 0; Y < oh; Y++) {
            for (let X = 0; X < ow; X++) {
                let x, y;
                switch (orientation) {
                    case 2:
                        x = w - 1 - X;
                        y = Y;
                        break;
                    case 3:
                        x = w - 1 - X;
                        y = h - 1 - Y;
                        break;
                    case 4:
                        x = X;
                        y = h - 1 - Y;
                        break;
                    case 5:
                        x = Y;
                        y = X;
                        break;
                    case 6:
                        x = Y;
                        y = h - 1 - X;
                        break;
                    case 7:
                        x = w - 1 - Y;
                        y = h - 1 - X;
                        break;
                    default:
                        x = w - 1 - Y;
                        y = X;
                        break;
                }
                dst[Y * ow + X] = src[y * w + x];
            }
        }
        return this.__apply__(out);
    }
    static SVG_MODE_SCALE = 1;
    static SVG_MODE_WIDTH = 2;
    static SVG_MODE_HEIGHT = 3;
    static async renderSVG(svg, sizeOrOptions = 1, modeArgument = SVGScaleModes.SCALE) {
        const options = isOptions(sizeOrOptions) ? sizeOrOptions : { size: sizeOrOptions, mode: modeArgument };
        const sizes = [options.width, options.height, options.scale].filter(value => value !== undefined).length;
        if (sizes > 1)
            throw new TypeError('renderSVG() takes one of width, height and scale');
        if (sizes && (options.size !== undefined || options.mode !== undefined))
            throw new TypeError('renderSVG() takes width, height or scale, or the deprecated size and mode, not both');
        if (options.font !== undefined && options.fonts !== undefined)
            throw new TypeError('renderSVG() takes font, or the deprecated fonts, not both');
        const { size = 1, mode: givenMode = SVGScaleModes.SCALE } = options.width !== undefined ? { size: options.width, mode: SVGScaleModes.WIDTH }
            : options.height !== undefined ? { size: options.height, mode: SVGScaleModes.HEIGHT }
                : options.scale !== undefined ? { size: options.scale, mode: SVGScaleModes.SCALE } : options;
        const { images: givenImages = {} } = options;
        const fonts = options.font === undefined ? options.fonts ?? [] : Array.isArray(options.font) ? options.font : [options.font];
        const mode = LEGACY_SVG_MODES.get(givenMode) ?? givenMode;
        if (mode !== 'scale' && mode !== 'width' && mode !== 'height')
            throw new Error('Invalid SVG scaling mode');
        finite(size, 'SVG size');
        if (mode === SVGScaleModes.SCALE && size <= 0)
            throw new RangeError('SVG scale must be > 0');
        if (mode !== SVGScaleModes.SCALE && size < 1)
            throw new RangeError('SVG size must be >= 1');
        if (typeof givenImages !== 'object' || givenImages === null || Array.isArray(givenImages) || givenImages instanceof Map)
            throw new TypeError('SVG images must be an object of hrefs to image data');
        const given = new Map();
        for (const href of Object.keys(givenImages)) {
            const value = givenImages[href];
            if (!(value instanceof Image) && !(value instanceof ArrayBuffer || ArrayBuffer.isView(value)))
                throw new TypeError(`SVG image ${JSON.stringify(href)} must be BinaryData or an Image`);
            given.set(href, value);
        }
        const source = typeof svg === 'string' ? svg : view(svg);
        const images = new Map();
        for (const { href, data } of svgRenderer.imageReferences(source)) {
            const value = given.get(href) ?? data;
            if (!value)
                continue;
            try {
                if (value instanceof Image) {
                    images.set(href, { width: value.width, height: value.height, pixels: value.bitmap });
                }
                else if (ImageType.getType(value) === 'gif') {
                    const decoded = gif.decode(view(value), true);
                    images.set(href, { width: decoded.width, height: decoded.height, pixels: gif.composite(decoded)[0].pixels });
                }
                else {
                    const image = await Image.decode(value);
                    images.set(href, { width: image.width, height: image.height, pixels: image.bitmap });
                }
            }
            catch {
            }
        }
        const { width, height, pixels } = svgRenderer.render(source, mode, size, images, fonts.map(font => view(font)));
        const image = new Image(width, height);
        image.bitmap.set(pixels);
        return image;
    }
    static async renderText(fontOrText, sizeOrOptions, textArgument, colorOrOptions = 0xffffffff, layoutArgument, styleArgument = {}) {
        let font, size, text, options;
        if (typeof fontOrText === 'string') {
            if (!isOptions(sizeOrOptions) || sizeOrOptions.font === undefined)
                throw new TypeError('renderText(text, options) needs the font in the options');
            ({ font, size, ...options } = sizeOrOptions);
            text = fontOrText;
        }
        else {
            font = fontOrText;
            size = sizeOrOptions;
            text = textArgument;
            options = isOptions(colorOrOptions) ? colorOrOptions : { ...styleArgument, color: colorOrOptions, layout: layoutArgument };
        }
        const { color = 0xffffffff, strokeWidth = 0, strokeColor = 0x000000ff, hinting = true, features = {}, variations = {} } = options;
        const layout = options.layout instanceof TextLayout ? options.layout : new TextLayout(options.layout);
        const axes = textRenderer.axisValues(variations);
        size = finite(size, 'font size');
        if (size < 0)
            throw new RangeError(`Invalid font size: ${size}`);
        if (finite(strokeWidth, 'stroke width') < 0)
            throw new RangeError('Invalid stroke width');
        const fonts = Array.isArray(font) ? font : [font];
        if (!fonts.length)
            throw new RangeError('No font given');
        const [r, g, b, a] = Colors.toRGBA(color);
        const rendered = await textRenderer.render(fonts.map(view), size, text, layout, hinting, (r << 24 | g << 16 | b << 8 | 255) >>> 0, featureList(features), axes);
        const pad = Math.ceil(strokeWidth);
        const width = rendered.width + 2 * pad, height = rendered.height + 2 * pad;
        const coverage = new Uint8Array(width * height);
        for (let y = 0; y < rendered.height; y++)
            coverage.set(rendered.coverage.subarray(y * rendered.width, (y + 1) * rendered.width), (y + pad) * width + pad);
        let colored = null;
        if (rendered.color) {
            colored = new Uint8ClampedArray(width * height * 4);
            for (let y = 0; y < rendered.height; y++)
                colored.set(rendered.color.subarray(y * rendered.width * 4, (y + 1) * rendered.width * 4), ((y + pad) * width + pad) * 4);
        }
        const image = new Image(width, height);
        const bitmap = image.bitmap;
        if (!strokeWidth && !colored) {
            const pixels = new Uint32Array(bitmap.buffer, bitmap.byteOffset, bitmap.length >> 2), lut = new Uint32Array(256);
            const bytes = new Uint8ClampedArray(lut.buffer);
            for (let v = 1; v < 256; v++)
                bytes.set([r, g, b, v * a / 255], v * 4);
            for (let i = 0; i < coverage.length; i++)
                if (coverage[i])
                    pixels[i] = lut[coverage[i]];
            return image;
        }
        let shape = coverage;
        if (colored) {
            shape = coverage.slice();
            for (let i = 0; i < shape.length; i++)
                shape[i] = Math.max(shape[i], colored[i * 4 + 3]);
        }
        const stroke = strokeWidth ? outline(shape, width, height, strokeWidth) : null;
        const [sr, sg, sb, sa] = Colors.toRGBA(strokeColor);
        for (let i = 0; i < coverage.length; i++) {
            let af = coverage[i] / 255 * a / 255, pr = r * af, pg = g * af, pb = b * af;
            if (colored && colored[i * 4 + 3]) {
                const ca = colored[i * 4 + 3] / 255 * a / 255, keep = 1 - ca, f = a / 255;
                pr = colored[i * 4] * f + pr * keep;
                pg = colored[i * 4 + 1] * f + pg * keep;
                pb = colored[i * 4 + 2] * f + pb * keep;
                af = ca + af * keep;
            }
            if (stroke) {
                const as = stroke[i] * sa / 255 * (1 - shape[i] / 255);
                pr += sr * as;
                pg += sg * as;
                pb += sb * as;
                af += as;
            }
            if (af <= 0)
                continue;
            bitmap[i * 4] = pr / af;
            bitmap[i * 4 + 1] = pg / af;
            bitmap[i * 4 + 2] = pb / af;
            bitmap[i * 4 + 3] = af * 255;
        }
        return image;
    }
}
const SUBSAMPLES = 4;
function pixelCoverage(px, py, inside) {
    let count = 0;
    for (let j = 0; j < SUBSAMPLES; j++)
        for (let i = 0; i < SUBSAMPLES; i++)
            if (inside(px + (i + 0.5) / SUBSAMPLES, py + (j + 0.5) / SUBSAMPLES))
                count++;
    return count / (SUBSAMPLES * SUBSAMPLES);
}
function circleCoverage(px, py, cx, cy, radius) {
    const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
    if (d <= radius - Math.SQRT1_2)
        return 1;
    if (d >= radius + Math.SQRT1_2)
        return 0;
    return pixelCoverage(px, py, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius);
}
const LEGACY_RESIZE_MODES = new Map([
    ['RESIZE_NEAREST_NEIGHBOR', 'nearest-neighbor'], ['RESIZE_BILINEAR', 'bilinear'], ['RESIZE_BICUBIC', 'bicubic'], ['RESIZE_AREA', 'area']
]);
export function resizeArguments(widthOrOptions, height, modeOrOptions) {
    if (!isOptions(widthOrOptions))
        return [widthOrOptions, height, modeOrOptions];
    const { width, height: optionsHeight, ...options } = widthOrOptions;
    if (width === undefined && optionsHeight === undefined)
        throw new TypeError('resize() needs a width, a height or both');
    return [width ?? ResizeModes.AUTO, optionsHeight ?? ResizeModes.AUTO, options];
}
function resizeOptions(modeOrOptions) {
    const options = isOptions(modeOrOptions) ? modeOrOptions : { mode: modeOrOptions };
    const mode = options.mode ?? ResizeModes.BILINEAR;
    return { mode: LEGACY_RESIZE_MODES.get(mode) ?? mode, fast: options.fast ?? true };
}
const LEGACY_SVG_MODES = new Map([[1, 'scale'], [2, 'width'], [3, 'height']]);
const hardLight = (b, s) => s <= 0.5 ? b * 2 * s : 1 - (1 - b) * (1 - (2 * s - 1));
const BLEND_MODES = {
    'normal': (_b, s) => s,
    'multiply': (b, s) => b * s,
    'screen': (b, s) => b + s - b * s,
    'overlay': (b, s) => hardLight(s, b),
    'darken': (b, s) => Math.min(b, s),
    'lighten': (b, s) => Math.max(b, s),
    'color-dodge': (b, s) => b === 0 ? 0 : s === 1 ? 1 : Math.min(1, b / (1 - s)),
    'color-burn': (b, s) => b === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - b) / s),
    'hard-light': hardLight,
    'soft-light': (b, s) => {
        if (s <= 0.5)
            return b - (1 - 2 * s) * b * (1 - b);
        const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
        return b + (2 * s - 1) * (d - b);
    },
    'difference': (b, s) => Math.abs(b - s),
    'exclusion': (b, s) => b + s - 2 * b * s,
    'add': (b, s) => Math.min(1, b + s)
};
function gradientFunction(stops) {
    if (!Array.isArray(stops))
        return Colors.gradient(stops);
    if (!stops.length)
        throw new RangeError('Invalid gradient point count');
    const colors = stops.length === 1 ? [stops[0], stops[0]] : stops;
    return Colors.gradient(Object.fromEntries(colors.map((color, i) => [i / (colors.length - 1), color])));
}
const OUTLINE_WINDOW = 1;
function outline(coverage, width, height, radius) {
    const count = width * height;
    const distance = new Float64Array(count);
    for (let i = 0; i < count; i++)
        distance[i] = coverage[i] >= 128 ? 0 : Infinity;
    const nearestY = new Int32Array(count), nearestX = new Int32Array(count);
    const size = Math.max(width, height);
    const line = new Float64Array(size), result = new Float64Array(size), nearest = new Int32Array(size);
    const parabolas = new Int32Array(size), bounds = new Float64Array(size + 1);
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++)
            line[y] = distance[y * width + x];
        distanceTransform(line, height, result, parabolas, bounds, nearest);
        for (let y = 0; y < height; y++) {
            distance[y * width + x] = result[y];
            nearestY[y * width + x] = nearest[y];
        }
    }
    const far = (radius + 2) ** 2;
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++)
            line[x] = distance[row + x] < far ? distance[row + x] : Infinity;
        distanceTransform(line, width, result, parabolas, bounds, nearest);
        for (let x = 0; x < width; x++) {
            distance[row + x] = result[x];
            nearestX[row + x] = nearest[x];
        }
    }
    const pointX = new Float32Array(count), pointY = new Float32Array(count), isEdge = new Uint8Array(count);
    for (let y = 1; y < height - 1; y++)
        for (let x = 1, e = y * width + 1; x < width - 1; x++, e++) {
            const c = coverage[e];
            if (!c || c === 255 && coverage[e - 1] >= 128 && coverage[e + 1] >= 128 && coverage[e - width] >= 128 && coverage[e + width] >= 128)
                continue;
            const above = e - width, below = e + width;
            const gx = coverage[above + 1] + 2 * coverage[e + 1] + coverage[below + 1] - coverage[above - 1] - 2 * coverage[e - 1] - coverage[below - 1];
            const gy = coverage[below - 1] + 2 * coverage[below] + coverage[below + 1] - coverage[above - 1] - 2 * coverage[above] - coverage[above + 1];
            const length = Math.sqrt(gx * gx + gy * gy);
            if (!length)
                continue;
            const outside = 0.5 - c / 255;
            pointX[e] = x + outside * gx / length;
            pointY[e] = y + outside * gy / length;
            isEdge[e] = 1;
        }
    const out = new Float32Array(count);
    const inner = radius - 1.5, near = inner > 0 ? inner * inner : -1;
    for (let y = 0, i = 0; y < height; y++)
        for (let x = 0; x < width; x++, i++) {
            const d2 = distance[i];
            if (d2 <= near)
                out[i] = 1;
            if (d2 <= near || d2 >= far) {
                if (d2 >= far)
                    out[i] = coverage[i] / 255;
                continue;
            }
            const qx = nearestX[i], qy = nearestY[y * width + qx];
            let closest = Infinity;
            for (let wy = Math.max(0, qy - OUTLINE_WINDOW); wy <= Math.min(height - 1, qy + OUTLINE_WINDOW); wy++)
                for (let wx = Math.max(0, qx - OUTLINE_WINDOW), e = wy * width + wx; wx <= Math.min(width - 1, qx + OUTLINE_WINDOW); wx++, e++) {
                    if (!isEdge[e])
                        continue;
                    const ex = x - pointX[e], ey = y - pointY[e];
                    closest = Math.min(closest, ex * ex + ey * ey);
                }
            closest = closest === Infinity ? Math.sqrt(d2) - 0.5 : Math.sqrt(closest);
            out[i] = Math.max(coverage[i] / 255, Math.min(1, Math.max(0, radius + 0.5 - closest)));
        }
    return out;
}
function distanceTransform(f, n, d, v, z, nearest) {
    let k = -1;
    for (let q = 0; q < n; q++) {
        if (f[q] === Infinity)
            continue;
        let s = 0;
        while (k >= 0) {
            s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            if (s > z[k])
                break;
            k--;
        }
        k++;
        v[k] = q;
        z[k] = k === 0 ? -Infinity : s;
        z[k + 1] = Infinity;
    }
    if (k < 0) {
        d.fill(Infinity, 0, n);
        return;
    }
    for (let q = 0, j = 0; q < n; q++) {
        while (z[j + 1] < q)
            j++;
        d[q] = (q - v[j]) ** 2 + f[v[j]];
        nearest[q] = v[j];
    }
}
