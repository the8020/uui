import { BinaryData } from './util/mem.d.ts';
import type { ToneMapping } from './codecs/hdr.d.ts';
import { ResizeMode, ResizeOptions, ResizeToOptions } from './image.d.ts';
import { Frame } from './frame.d.ts';
import { Metadata } from './metadata.d.ts';
import { AnimationEncoder } from './animation-encoder.d.ts';
/** Options of {@link Animation} */
export interface AnimationOptions {
    /**
     * How many times to repeat the animation (`Infinity` = forever, 0 = play once, 1 = play twice, ...). `-1` still
     * means forever, it will be removed in 4.0. Default: forever
     */
    loopCount?: number;
}
/** Options of {@link Animation.decode} */
export interface AnimationDecodeOptions {
    /** Whether to stop decoding after the first frame. Default: `false` */
    onlyFirstFrame?: boolean;
    /**
     * The most pixels to decode, of all frames together (every frame is a full canvas): larger animations throw a
     * RangeError before anything that size is allocated, so small files declaring huge animations (decompression
     * bombs) can't exhaust the memory. Default: `268402689` (16383², like sharp), `Infinity` for no limit
     */
    maxPixels?: number;
    /** Whether to convert the colors of frames with an embedded ICC profile (APNGs, WebPs) to sRGB, like `applyColorProfile` of {@link Image.decode}. Default: `true` */
    applyColorProfile?: boolean;
    /** At most this many worker threads decode in parallel, like `threads` of {@link Image.decode}. Default: the processors available, at most 8 */
    threads?: number;
    /**
     * Whether to rotate/mirror the frames as the orientation tag (Exif, JPEG XL's header, PNG's eXIf chunk or XMP)
     * says, like `applyOrientation` of {@link Image.decode}: APNGs, animated WebPs and JPEG XLs. Default: `true`
     */
    applyOrientation?: boolean;
    /**
     * How HDR (PQ or HLG) JPEG XL animations, whose light can be brighter than (SDR) white, become 8 bit sRGB, like
     * `toneMapping` of {@link Image.decode}: `'reinhard'` compresses the brightest parts, `'clamp'` clamps everything
     * brighter than white. Default: `'reinhard'`
     */
    toneMapping?: ToneMapping;
    /**
     * Whether to read the gain map (jhgm box) of JPEG XL animations into {@link Image.gainMap} of every frame, like
     * `gainMap` of {@link Image.decode}. Default: `true`
     */
    gainMap?: boolean;
}
/** The options all animation encoders have */
export interface AnimationEncodeOptions {
    /** Metadata to include, see {@link Metadata} */
    metadata?: Metadata;
    /**
     * Whether to store each frame as the area that changed since the frame before and merge identical frames, which
     * usually makes files a lot smaller. The file shows the same animation either way, but only decodes to the same
     * frames without it, which also encodes faster when little changes. Default: `true`
     */
    optimize?: boolean;
}
/** Options of {@link Animation.encodeWebP} */
export interface WebPAnimationEncodeOptions extends AnimationEncodeOptions {
    /**
     * Lossy frames (0-100, like libwebp's quality: 75 is its default), much smaller than lossless ones. Without it the
     * frames are lossless. Optimized lossy frames, like libwebp's, leave out 8x8 blocks that only changed a little (by
     * up to 3 per channel at quality 85, 1 at 100)
     */
    quality?: number;
    /** How much effort the frames take (0-6, lossy and lossless), see {@link WebPEncodeOptions.effort}. Default: `2` */
    effort?: number;
    /** Lossy frames: libwebp's sharp YUV conversion, see {@link WebPEncodeOptions.sharpYuv}. Default: `false` */
    sharpYuv?: boolean;
    /** Lossy frames: the alpha planes' quality (0-100), see {@link WebPEncodeOptions.alphaQuality}. Default: `100` */
    alphaQuality?: number;
}
/** Options of {@link Animation.encodeGIF} */
export interface GIFEncodeOptions extends AnimationEncodeOptions {
    /** 1-100, scales the palette size from 8 colors (1) to 256 colors (90 and above). Default: `95` */
    quality?: number;
}
/** Options of {@link Animation.encodeAPNG} */
export interface APNGEncodeOptions extends AnimationEncodeOptions {
    /** The zlib compression level (0-9), higher is smaller but slower. Default: `4` */
    compression?: number;
}
/**
 * An animation: frames ({@link Animation.frames}) that can be decoded from and encoded to GIF, APNG and WebP.
 *
 * The animation itself is an array of its frames too (`animation[0]`, `animation.map(...)`), which is deprecated: in 4.0
 * it won't extend `Array` anymore, use {@link Animation.frames} instead. Array methods like map and filter return
 * plain arrays.
 */
export declare class Animation extends Array<Frame> {
    /**
     * How many times to repeat the animation (`Infinity` = forever, 0 = play once, 1 = play twice, ...). `-1` still
     * means forever, it will be removed in 4.0, when `Infinity` is what animations that loop forever have (animations
     * that loop forever have `-1` until then, also the decoded ones)
     */
    loopCount: number;
    /**
     * Creates a new animation
     * @param frames The frames to create the animation from
     * @param options See {@link AnimationOptions}
     */
    constructor(frames: Frame[], options?: AnimationOptions);
    /**
     * Creates a new animation
     * @param frames The frames to create the animation from
     * @param loopCount How many times to repeat the animation (`Infinity` = forever, 0 = play once, 1 = play twice, ...)
     * @deprecated Pass {@link AnimationOptions} instead, the positional arguments will be removed in 4.0
     */
    constructor(frames: Frame[], loopCount?: number);
    /**
     * The animation's frames: an array that changes the animation when it's changed (e.g. `push()`, `splice()`, or
     * setting an index), and can be replaced as a whole
     */
    get frames(): Frame[];
    /**
     * Replaces the animation's frames
     * @param frames The new frames (copied into the animation, the array itself isn't kept)
     */
    set frames(frames: Frame[]);
    /** The animation's width */
    get width(): number;
    /** The animation's height */
    get height(): number;
    /** The animation's duration (in ms) */
    get duration(): number;
    /** A short description for debugging, e.g. `Animation<64x64x1000ms>` */
    toString(): string;
    /**
     * Returns a new animation of the same class containing a range of this one's frames
     * (same semantics as Array.prototype.slice)
     * @param start The index of the first frame (negative counts from the end). Default: `0`
     * @param end The index after the last frame (negative counts from the end). Default: the frame count
     * @deprecated Use `new Animation(animation.frames.slice(start, end), animation.loopCount)`: in 4.0 animations
     *     aren't arrays anymore
     * @group Deprecated
     */
    slice(start?: number, end?: number): this;
    /**
     * Resizes the animation to the given dimensions, scaling every frame and its offsets proportionally.
     * Pass {@link ResizeToOptions} with only a width or a height to keep the aspect ratio.
     * @param width The new width
     * @param height The new height
     * @param options See {@link ResizeOptions}
     */
    resize(width: number, height: number, options?: ResizeOptions): this;
    /**
     * Resizes the animation to the given dimensions, scaling every frame and its offsets proportionally.
     * Pass {@link ResizeToOptions} with only a width or a height to keep the aspect ratio.
     * @param width The new width
     * @param height The new height
     * @param mode The resizing mode to use. Default: {@link ResizeModes.BILINEAR}
     * @deprecated Pass {@link ResizeOptions} with `mode` instead, the positional mode will be removed in 4.0
     */
    resize(width: number, height: number, mode?: ResizeMode): this;
    /**
     * Resizes the animation, scaling every frame and its offsets proportionally: to the given width or height (the
     * other side keeps the aspect ratio), or to both
     * @param options The size and how to resize, see {@link ResizeToOptions}
     */
    resize(options: ResizeToOptions): this;
    /**
     * Encodes the animation as GIF. Like all encoders, it stores each frame as the area that changed since the frame
     * before and merges identical frames (unless the `optimize` option is false), so the file decodes to what the
     * animation shows, but not necessarily to the same frames. Semi-transparent pixels become opaque or transparent
     * after the frames are composited
     * @param options See {@link GIFEncodeOptions}
     */
    encodeGIF(options?: GIFEncodeOptions): Promise<Uint8Array>;
    /**
     * Encodes the animation as GIF. Like all encoders, it stores each frame as the area that changed since the frame
     * before and merges identical frames (unless the `optimize` option is false), so the file decodes to what the
     * animation shows, but not necessarily to the same frames. Semi-transparent pixels become opaque or transparent
     * after the frames are composited
     * @param quality 1-100, scales the palette size from 8 colors (1) to 256 colors (90 and above)
     * @deprecated Pass {@link GIFEncodeOptions} instead, the positional arguments will be removed in 4.0
     */
    encodeGIF(quality?: number): Promise<Uint8Array>;
    /**
     * Encodes the animation as APNG (animated PNG, lossless and with full alpha). Viewers without APNG support show
     * the first frame. Each frame is stored as the area that changed since the frame before, identical frames are
     * merged (unless the `optimize` option is false): the file shows exactly the same animation, but doesn't
     * necessarily decode to the same frames
     * @param options See {@link APNGEncodeOptions}
     */
    encodeAPNG(options?: APNGEncodeOptions): Promise<Uint8Array>;
    /**
     * Encodes the animation as APNG (animated PNG, lossless and with full alpha). Viewers without APNG support show
     * the first frame. Each frame is stored as the area that changed since the frame before, identical frames are
     * merged (unless the `optimize` option is false): the file shows exactly the same animation, but doesn't
     * necessarily decode to the same frames
     * @param compression The zlib compression level (0-9), higher is smaller but slower. Default: `4`
     * @deprecated Pass {@link APNGEncodeOptions} instead, the positional arguments will be removed in 4.0
     */
    encodeAPNG(compression?: number): Promise<Uint8Array>;
    /**
     * Encodes the animation as animated WebP, lossless or (with a quality) lossy. Each frame is stored as the area that
     * changed since the frame before, identical frames are merged (unless the `optimize` option is false): the file
     * shows the same animation, but doesn't necessarily decode to the same frames
     * @param options See {@link WebPAnimationEncodeOptions}
     */
    encodeWebP({ metadata, optimize, quality, effort, sharpYuv, alphaQuality }?: WebPAnimationEncodeOptions): Promise<Uint8Array>;
    /**
     * An encoder that makes an animated WebP a frame at a time, like {@link Animation.encodeWebP} (the same file),
     * without keeping the frames in memory: `await encoder.add(frame)` for each frame (a {@link Frame}, or an image
     * with `{ duration }`), then `await encoder.finish()` for the file
     * @param width The canvas width
     * @param height The canvas height
     * @param options See {@link WebPAnimationEncodeOptions}, and {@link AnimationOptions.loopCount}
     */
    static webpEncoder(width: number, height: number, options?: WebPAnimationEncodeOptions & AnimationOptions): AnimationEncoder;
    /**
     * An encoder that makes an animated GIF a frame at a time, like {@link Animation.encodeGIF} (the same file),
     * without keeping the frames in memory: `await encoder.add(frame)` for each frame, then `await encoder.finish()`
     * @param width The canvas width
     * @param height The canvas height
     * @param options See {@link GIFEncodeOptions}, and {@link AnimationOptions.loopCount}
     */
    static gifEncoder(width: number, height: number, options?: GIFEncodeOptions & AnimationOptions): AnimationEncoder;
    /**
     * An encoder that makes an APNG a frame at a time, like {@link Animation.encodeAPNG} (the same file), keeping the
     * frames only compressed (the pixel format depends on all of them): `await encoder.add(frame)` for each frame,
     * then `await encoder.finish()`
     * @param width The canvas width
     * @param height The canvas height
     * @param options See {@link APNGEncodeOptions}, and {@link AnimationOptions.loopCount}
     */
    static apngEncoder(width: number, height: number, options?: APNGEncodeOptions & AnimationOptions): AnimationEncoder;
    /**
     * Decodes an animated GIF, APNG, WebP or JPEG XL into fully composited frames (still images become a single frame)
     * @param input The binary data to decode
     * @param options See {@link AnimationDecodeOptions}
     */
    static decode(input: BinaryData, options?: AnimationDecodeOptions): Promise<Animation>;
    /**
     * Decodes an animated GIF, APNG, WebP or JPEG XL into fully composited frames (still images become a single frame)
     * @param input The binary data to decode
     * @param onlyExtractFirstFrame Whether to stop decoding after the first frame
     * @deprecated Pass {@link AnimationDecodeOptions} instead, the positional arguments will be removed in 4.0
     */
    static decode(input: BinaryData, onlyExtractFirstFrame?: boolean): Promise<Animation>;
}
