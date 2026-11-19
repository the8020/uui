import { Image } from './image.d.ts';
import { BinaryData } from './util/mem.d.ts';
/** Options of {@link GainMap.encode} */
export interface GainMapEncodeOptions {
    /** The JPEG quality (1-100). Default: `90` */
    quality?: number;
}
/** Options of the {@link GainMap} constructor: per channel values can be one number for all three or [r, g, b] */
export interface GainMapOptions {
    /** log2 of the boost of the map's value 0 (`-1`: half as bright). Default: `0` */
    min?: number | number[];
    /** log2 of the boost of the map's value 255 (`2`: 4 times as bright). Default: `2` */
    max?: number | number[];
    /**
     * Like {@link GainMapOptions.min}
     * @deprecated Use `min`, its name in 4.0, which ignores `gainMapMin`
     */
    gainMapMin?: number | number[];
    /**
     * Like {@link GainMapOptions.max}
     * @deprecated Use `max`, its name in 4.0, which ignores `gainMapMax`
     */
    gainMapMax?: number | number[];
    /** the gamma the map's values are stored with. Default: `1` */
    gamma?: number | number[];
    /** added to the SDR image's linear values before the boost (keeps black from being boosted forever). Default: `1/64` */
    offsetSDR?: number | number[];
    /** subtracted from the HDR result. Default: `1/64` */
    offsetHDR?: number | number[];
    /** log2 of the display headroom from which on the map starts to apply. Default: `0` */
    hdrCapacityMin?: number;
    /** log2 of the display headroom at which it applies fully. Default: `gainMapMax`'s largest value */
    hdrCapacityMax?: number;
    /** whether the boost applies in the SDR image's color space (`false`: in the HDR image's). Default: `true` */
    useBaseColorSpace?: boolean;
}
/**
 * A gain map: a small image saying how much brighter each part of an image gets on an HDR display, as Ultra HDR
 * (JPEG-R) photos from phones carry it. HDR displays show the image boosted by it, the others the image as it is.
 *
 * {@link Image.decode} reads the gain maps of JPEGs, AVIFs and JPEG XLs into {@link Image.gainMap},
 * {@link Image.encodeJPEG}, {@link Image.encodeAVIF} and {@link Image.encodeJXL} write them. The map covers the whole image, at any resolution (phones
 * write a quarter of the width and height). Its value `v` (0-255, per channel or one for all) boosts the linear
 * light of the image by `2^(gainMapMin + (gainMapMax - gainMapMin) * (v / 255)^(1 / gamma))`
 */
export declare class GainMap {
    /**
     * log2 of the boost of the map's value 0, per channel (red, green, blue)
     * @deprecated Use {@link GainMap.min}, its name in 4.0
     */
    gainMapMin: number[];
    /**
     * log2 of the boost of the map's value 255, per channel
     * @deprecated Use {@link GainMap.max}, its name in 4.0
     */
    gainMapMax: number[];
    /** the gamma the map's values are stored with, per channel */
    gamma: number[];
    /** added to the SDR image's linear values before the boost, per channel */
    offsetSDR: number[];
    /** subtracted from the HDR result, per channel */
    offsetHDR: number[];
    /** log2 of the display headroom from which on the map starts to apply */
    hdrCapacityMin: number;
    /** log2 of the display headroom at which it applies fully */
    hdrCapacityMax: number;
    /** whether the boost applies in the SDR image's color space (else in the HDR image's) */
    useBaseColorSpace: boolean;
    /** its pixels */
    private __pixels__;
    /**
     * Creates a gain map
     * @param image The map's pixels: grey (red, green and blue the same) for one map for all channels. Its alpha is
     *     ignored
     * @param options See {@link GainMapOptions}
     */
    /** log2 of the boost of the map's value 0, per channel (red, green, blue): {@link GainMap.gainMapMin}, by its name in 4.0 */
    get min(): number[];
    /** Sets {@link GainMap.gainMapMin} */
    set min(value: number[]);
    /** log2 of the boost of the map's value 255, per channel: {@link GainMap.gainMapMax}, by its name in 4.0 */
    get max(): number[];
    /** Sets {@link GainMap.gainMapMax} */
    set max(value: number[]);
    constructor(image: Image, options?: GainMapOptions);
    private __set_params__;
    private __check__;
    /** The map's pixels. Changes to them are written when the image is encoded */
    get image(): Image;
    /**
     * Replaces the map's pixels
     * @param image The new map, at any resolution: it covers the whole image
     */
    set image(image: Image);
    /** The map's width */
    get width(): number;
    /** The map's height */
    get height(): number;
    /** `1` for a grey map (one boost for red, green and blue), `3` for one per channel */
    get channels(): 1 | 3;
    /** Clones the gain map (its pixels too) */
    clone(): GainMap;
    /**
     * Encodes the gain map alone: a JPEG with its parameters (hdrgm XMP and ISO 21496-1), like the second image in an
     * Ultra HDR JPEG
     * @param options See {@link GainMapEncodeOptions}
     */
    encode(options?: GainMapEncodeOptions): Promise<Uint8Array>;
    /**
     * Encodes the gain map alone: a JPEG with its parameters (hdrgm XMP and ISO 21496-1), like the second image in an
     * Ultra HDR JPEG
     * @param quality The JPEG quality (1-100). Default: `90`
     * @deprecated Pass {@link GainMapEncodeOptions} instead, the positional arguments will be removed in 4.0
     */
    encode(quality?: number): Promise<Uint8Array>;
    /**
     * Decodes a gain map JPEG with its parameters (hdrgm XMP or ISO 21496-1), like the second image in an Ultra HDR
     * JPEG, or the gain map of an Ultra HDR JPEG (or an iPhone's JPEG: its values converted to these parameters)
     * @param data The JPEG
     */
    static decode(data: BinaryData): Promise<GainMap>;
}
