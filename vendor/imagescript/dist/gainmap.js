import { Image } from "./image.js";
import * as jpeg from "./codecs/jpeg.js";
import * as codec from "./codecs/gainmap.js";
import { view } from "./util/mem.js";
import { finite, isOptions, quality as checkQuality } from "./util/options.js";
const perChannel = (value, name) => {
    const values = typeof value === 'number' ? [value, value, value] : Array.from(value);
    if (values.length === 1)
        values.push(values[0], values[0]);
    if (values.length !== 3)
        throw new RangeError(`${name} must be a number or an array of 3 numbers`);
    return values.map(v => finite(v, name));
};
export class GainMap {
    gainMapMin;
    gainMapMax;
    gamma;
    offsetSDR;
    offsetHDR;
    hdrCapacityMin;
    hdrCapacityMax;
    useBaseColorSpace;
    __pixels__ = null;
    get min() {
        return this.gainMapMin;
    }
    set min(value) {
        this.gainMapMin = value;
    }
    get max() {
        return this.gainMapMax;
    }
    set max(value) {
        this.gainMapMax = value;
    }
    constructor(image, options = {}) {
        if (!(image instanceof Image))
            throw new TypeError('The gain map has to be an Image');
        if (options.min !== undefined && options.gainMapMin !== undefined)
            throw new TypeError('A gain map takes min, or the deprecated gainMapMin, not both');
        if (options.max !== undefined && options.gainMapMax !== undefined)
            throw new TypeError('A gain map takes max, or the deprecated gainMapMax, not both');
        const { gamma = 1, offsetSDR = 1 / 64, offsetHDR = 1 / 64, hdrCapacityMin = 0, useBaseColorSpace = true } = options;
        const gainMapMin = options.min ?? options.gainMapMin ?? 0, gainMapMax = options.max ?? options.gainMapMax ?? 2;
        this.gainMapMin = perChannel(gainMapMin, 'gainMapMin');
        this.gainMapMax = perChannel(gainMapMax, 'gainMapMax');
        this.gamma = perChannel(gamma, 'gamma');
        this.offsetSDR = perChannel(offsetSDR, 'offsetSDR');
        this.offsetHDR = perChannel(offsetHDR, 'offsetHDR');
        this.hdrCapacityMin = finite(hdrCapacityMin, 'hdrCapacityMin');
        this.hdrCapacityMax = finite(options.hdrCapacityMax ?? Math.max(...this.gainMapMax), 'hdrCapacityMax');
        this.useBaseColorSpace = Boolean(useBaseColorSpace);
        this.__pixels__ = image;
        this.__check__();
    }
    static __from_jpeg__(map, params, apple = 0) {
        const { width, height, pixels } = jpeg.decode(map);
        const image = new Image(width, height);
        image.bitmap = pixels;
        if (apple) {
            const table = new Uint8Array(256);
            for (let v = 0; v < 256; v++)
                table[v] = Math.round(255 * codec.appleValue(v / 255, apple));
            for (let i = 0; i < pixels.length; i += 4) {
                pixels[i] = table[pixels[i]];
                pixels[i + 1] = table[pixels[i + 1]];
                pixels[i + 2] = table[pixels[i + 2]];
            }
        }
        return GainMap.__from_pixels__(image, params, false);
    }
    static __from_pixels__(image, params, grey = true) {
        const px = image.bitmap;
        if (grey) {
            let spread = 0;
            for (let i = 0; i < px.length && spread <= 2; i += 4)
                spread = Math.max(spread, Math.abs(px[i] - px[i + 1]), Math.abs(px[i] - px[i + 2]));
            if (spread > 0 && spread <= 2)
                for (let i = 0; i < px.length; i += 4)
                    px[i] = px[i + 1] = px[i + 2] = Math.round((px[i] + px[i + 1] + px[i + 2]) / 3);
        }
        const gainMap = Object.create(GainMap.prototype);
        gainMap.__pixels__ = image;
        gainMap.__set_params__(params);
        return gainMap;
    }
    __set_params__(p) {
        this.gainMapMin = p.min.slice();
        this.gainMapMax = p.max.slice();
        this.gamma = p.gamma.slice();
        this.offsetSDR = p.offsetSDR.slice();
        this.offsetHDR = p.offsetHDR.slice();
        this.hdrCapacityMin = p.capacityMin;
        this.hdrCapacityMax = p.capacityMax;
        this.useBaseColorSpace = p.useBaseColorSpace;
    }
    __params__() {
        this.__check__();
        return {
            min: this.gainMapMin.slice(), max: this.gainMapMax.slice(), gamma: this.gamma.slice(), offsetSDR: this.offsetSDR.slice(),
            offsetHDR: this.offsetHDR.slice(), capacityMin: this.hdrCapacityMin, capacityMax: this.hdrCapacityMax, useBaseColorSpace: this.useBaseColorSpace
        };
    }
    __check__() {
        const p = {
            min: perChannel(this.gainMapMin, 'gainMapMin'), max: perChannel(this.gainMapMax, 'gainMapMax'), gamma: perChannel(this.gamma, 'gamma'),
            offsetSDR: perChannel(this.offsetSDR, 'offsetSDR'), offsetHDR: perChannel(this.offsetHDR, 'offsetHDR'),
            capacityMin: finite(this.hdrCapacityMin, 'hdrCapacityMin'), capacityMax: finite(this.hdrCapacityMax, 'hdrCapacityMax'), useBaseColorSpace: this.useBaseColorSpace
        };
        for (let c = 0; c < 3; c++) {
            if (p.gamma[c] <= 0)
                throw new RangeError('The gain map\'s gamma must be above 0');
            if (p.max[c] < p.min[c])
                throw new RangeError('The gain map\'s gainMapMax must be at least its gainMapMin');
        }
        if (p.capacityMin < 0 || p.capacityMax <= p.capacityMin)
            throw new RangeError('The gain map\'s hdrCapacityMax must be above its hdrCapacityMin, which can\'t be negative');
    }
    get image() {
        return this.__pixels__;
    }
    set image(image) {
        if (!(image instanceof Image))
            throw new TypeError('The gain map has to be an Image');
        this.__pixels__ = image;
    }
    get width() {
        return this.__pixels__.width;
    }
    get height() {
        return this.__pixels__.height;
    }
    get channels() {
        const bitmap = this.__pixels__.bitmap;
        for (let i = 0; i < bitmap.length; i += 4)
            if (bitmap[i] !== bitmap[i + 1] || bitmap[i] !== bitmap[i + 2])
                return 3;
        return 1;
    }
    clone() {
        const copy = Object.create(GainMap.prototype);
        copy.__set_params__(this.__params__());
        copy.__pixels__ = this.__pixels__.clone();
        return copy;
    }
    __body__(quality, width, height) {
        let image = this.image;
        if (width !== undefined && height !== undefined && (width !== image.width || height !== image.height))
            image = image.clone().resize(width, height);
        const bitmap = image.bitmap;
        const pixels = new Uint8Array(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength);
        const grey = this.channels === 1;
        return jpeg.encode(pixels, image.width, image.height, quality ?? 90, { grey, fullChroma: !grey });
    }
    __neutral__() {
        return [0, 1, 2].map(c => {
            const min = this.gainMapMin[c], max = this.gainMapMax[c];
            const t = max > min ? Math.min(1, Math.max(0, -min / (max - min))) : 0;
            return Math.round(255 * t ** this.gamma[c]);
        });
    }
    __rescale__(oldWidth, oldHeight, width, height) {
        const mapWidth = Math.max(1, Math.round(width * this.width / oldWidth)), mapHeight = Math.max(1, Math.round(height * this.height / oldHeight));
        if (mapWidth === this.width && mapHeight === this.height)
            return;
        this.image = this.image.clone().resize(mapWidth, mapHeight);
    }
    __transform__(oldWidth, oldHeight, width, height, toOld, zoom = 1) {
        let map = this.image;
        const mapWidth = Math.max(1, Math.round(width * map.width / oldWidth)), mapHeight = Math.max(1, Math.round(height * map.height / oldHeight));
        if (zoom < 0.5)
            map = map.clone().resize(Math.max(1, Math.round(map.width * zoom * 2)), Math.max(1, Math.round(map.height * zoom * 2)));
        const sx = map.width / oldWidth, sy = map.height / oldHeight;
        const src = map.bitmap, mw = map.width, mh = map.height;
        const out = new Image(mapWidth, mapHeight), dst = out.bitmap;
        const neutral = this.__neutral__();
        for (let j = 0, d = 0; j < mapHeight; j++) {
            for (let i = 0; i < mapWidth; i++, d += 4) {
                dst[d + 3] = 255;
                const old = toOld((i + 0.5) * width / mapWidth, (j + 0.5) * height / mapHeight);
                if (!old || !(old[0] >= 0 && old[0] <= oldWidth && old[1] >= 0 && old[1] <= oldHeight)) {
                    dst[d] = neutral[0];
                    dst[d + 1] = neutral[1];
                    dst[d + 2] = neutral[2];
                    continue;
                }
                const u = Math.min(mw - 1, Math.max(0, old[0] * sx - 0.5)), v = Math.min(mh - 1, Math.max(0, old[1] * sy - 0.5));
                const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(mw - 1, x0 + 1), y1 = Math.min(mh - 1, y0 + 1);
                const fx = u - x0, fy = v - y0;
                const a = 4 * (y0 * mw + x0), b = 4 * (y0 * mw + x1), c = 4 * (y1 * mw + x0), e = 4 * (y1 * mw + x1);
                for (let k = 0; k < 3; k++)
                    dst[d + k] = (src[a + k] * (1 - fx) + src[b + k] * fx) * (1 - fy) + (src[c + k] * (1 - fx) + src[e + k] * fx) * fy;
            }
        }
        this.image = out;
    }
    async encode(qualityOrOptions) {
        let quality = isOptions(qualityOrOptions) ? qualityOrOptions.quality : qualityOrOptions;
        if (quality !== undefined)
            quality = Math.max(1, checkQuality(quality));
        return codec.mapWithMetadata(this.__body__(quality), this.__params__());
    }
    static async decode(data) {
        const bytes = view(data);
        const found = codec.find(bytes);
        if (found)
            return GainMap.__from_jpeg__(found.map, found.params, found.apple);
        const params = codec.readParams(bytes);
        if (!params)
            throw new Error('No gain map (or no gain map parameters) found');
        return GainMap.__from_jpeg__(bytes, params);
    }
}
