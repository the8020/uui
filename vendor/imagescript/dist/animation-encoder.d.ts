import { Image } from './image.d.ts';
import { Frame, FrameOptions } from './frame.d.ts';
import type { AnimationOptions, AnimationEncodeOptions, WebPAnimationEncodeOptions, GIFEncodeOptions, APNGEncodeOptions } from './animation.d.ts';
/**
 * The options all animation encoders of {@link Animation.webpEncoder} and the others have
 * @deprecated {@link Animation.webpEncoder} and the others take the options of {@link Animation.encodeWebP} and the
 *     others ({@link AnimationEncodeOptions}) with the {@link AnimationOptions.loopCount}, this will be removed in 4.0
 * @group Deprecated
 */
export type AnimationEncoderOptions = AnimationEncodeOptions & AnimationOptions;
/**
 * Options of {@link Animation.webpEncoder}
 * @deprecated Use {@link WebPAnimationEncodeOptions}, with {@link AnimationOptions.loopCount}: this will be removed
 *     in 4.0
 * @group Deprecated
 */
export type WebPAnimationEncoderOptions = WebPAnimationEncodeOptions & AnimationOptions;
/**
 * Options of {@link Animation.gifEncoder}
 * @deprecated Use {@link GIFEncodeOptions}, with {@link AnimationOptions.loopCount}: this will be removed in 4.0
 * @group Deprecated
 */
export type GIFAnimationEncoderOptions = GIFEncodeOptions & AnimationOptions;
/**
 * Options of {@link Animation.apngEncoder}
 * @deprecated Use {@link APNGEncodeOptions}, with {@link AnimationOptions.loopCount}: this will be removed in 4.0
 * @group Deprecated
 */
export type APNGAnimationEncoderOptions = APNGEncodeOptions & AnimationOptions;
/**
 * Encodes an animation a frame at a time, without keeping all frames in memory: see {@link Animation.webpEncoder},
 * {@link Animation.gifEncoder} and {@link Animation.apngEncoder}. The file is the one an {@link Animation} of the
 * frames encodes to, but for unoptimized WebPs with frames WebP can't store as they are (disposed to the previous
 * frame, or disposed with odd offsets): from the first of them on, the frames are the canvas they show (the same
 * animation, blending rounds differently by 1 at most). APNGs keep their frames compressed until the end: their pixel
 * format depends on all of them
 */
export declare class AnimationEncoder {
    private readonly format;
    private optimizer;
    private queue;
    private count;
    private finished;
    /** The canvas width */
    readonly width: number;
    /** The canvas height */
    readonly height: number;
    /** How many frames were added */
    get frameCount(): number;
    /**
     * How many frames were added
     * @deprecated Use {@link AnimationEncoder.frameCount}, `frames` will be removed in 4.0
     * @group Deprecated
     */
    get frames(): number;
    /**
     * Adds the next frame: a {@link Frame} (with its duration, offsets and disposal) or an image (a frame of 100 ms by
     * default). The options override the frame's. The pixels are copied right away, the image can change afterwards
     * @param frame The frame or image
     * @param options See {@link FrameOptions}
     */
    add(frame: Frame | Image, options?: FrameOptions): Promise<void>;
    /** Encodes the rest and returns the file. The encoder can't be used afterwards */
    finish(): Promise<Uint8Array>;
}
