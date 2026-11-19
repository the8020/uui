import { BinaryData } from './util/mem.d.ts';
import { Frame } from './frame.d.ts';
import { Animation, AnimationDecodeOptions, AnimationOptions, GIFEncodeOptions } from './animation.d.ts';
/**
 * Represents a GIF image as an array of frames, an {@link Animation} whose `encode()` and `decode()` work with GIFs.
 * Array methods like map and filter return plain arrays.
 * @deprecated Use {@link Animation}, which works the same and also handles APNG: `new Animation(frames, loopCount)`,
 *     {@link Animation.decode} and {@link Animation.encodeGIF}. `GIF` will be removed in 4.0
 * @group Deprecated
 */
export declare class GIF extends Animation {
    /**
     * Creates a new GIF image
     * @param frames The frames to create the GIF from
     * @param loopCountOrOptions How many times to repeat the GIF (`Infinity` = forever, 0 = play once), or see
     *     {@link AnimationOptions}
     */
    constructor(frames: Frame[], loopCountOrOptions?: number | AnimationOptions);
    /** A short description for debugging, e.g. `GIF<64x64x1000ms>` */
    toString(): string;
    /**
     * Encodes the GIF
     * @param qualityOrOptions 1-100, scales the palette size from 8 colors (1) to 256 colors (90 and above), or
     *     see {@link GIFEncodeOptions}
     * @deprecated Use {@link Animation.encodeGIF}
     */
    encode(qualityOrOptions?: number | GIFEncodeOptions): Promise<Uint8Array>;
    /**
     * Decodes a GIF into fully composited frames
     * @param input The binary data to decode
     * @param onlyFirstFrameOrOptions Whether to end GIF decoding after the first frame, or see
     *     {@link AnimationDecodeOptions}
     * @deprecated Use {@link Animation.decode}, which decodes APNGs too
     */
    static decode(input: BinaryData, onlyFirstFrameOrOptions?: boolean | AnimationDecodeOptions): Promise<GIF>;
}
