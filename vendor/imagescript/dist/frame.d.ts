import { Image, ResizeMode, ResizeOptions, ResizeToOptions, Color, TrimOptions } from './image.d.ts';
/** Names of the frame disposal modes, see {@link Frame.disposalMode} */
export type FrameDisposalMode = 'any' | 'keep' | 'previous' | 'background';
/**
 * Names of the frame disposal modes, see {@link Frame.disposalMode}
 * @deprecated Use {@link FrameDisposalMode}, its name in 4.0
 */
export type FrameDisposalModeName = FrameDisposalMode;
/**
 * Ids of the frame disposal modes, as GIFs store them (0 any, 1 keep, 2 previous, 3 background)
 * @deprecated Use the names ({@link FrameDisposalMode}: `'any'`, `'keep'`, `'previous'`, `'background'`), the ids will
 *     be removed in 4.0
 */
export type FrameDisposalModeId = 0 | 1 | 2 | 3;
/**
 * What happens to a frame's area before the next frame is drawn, see {@link Frame.disposalMode}
 * @deprecated Use the names, `'background'` for `FrameDisposalModes.BACKGROUND`: `FrameDisposalModes` is removed in 4.0
 */
export declare class FrameDisposalModes {
    /** The decoder decides (in practice like {@link FrameDisposalModes.KEEP}) */
    static readonly ANY = "any";
    /** The frame stays, the next one is drawn over it (the default) */
    static readonly KEEP = "keep";
    /** The frame's area goes back to what it was before the frame */
    static readonly PREVIOUS = "previous";
    /** The frame's area is cleared to transparent */
    static readonly BACKGROUND = "background";
    private constructor();
}
/** Options of {@link Frame} and {@link Frame.from} */
export interface FrameOptions {
    /** The frame's duration in milliseconds. Default: `100` */
    duration?: number;
    /** The frame's offset on the x-axis. Default: `0` */
    xOffset?: number;
    /** The frame's offset on the y-axis. Default: `0` */
    yOffset?: number;
    /** The frame's disposal mode, see {@link Frame.disposalMode}. Default: `'keep'` */
    disposalMode?: FrameDisposalModeName | FrameDisposalModeId;
}
/**
 * Represents a frame of an {@link Animation}: an {@link Image} with a duration, offsets and a disposal mode, so every
 * method of {@link Image} works on it too
 */
export declare class Frame extends Image {
    /**
     * Milliseconds. GIFs store hundredths of a second, so this is rounded to 10 ms when encoding a GIF;
     * note that browsers play frames shorter than 20 ms with 100 ms
     */
    duration: number;
    /** The frame's horizontal offset in the animation */
    xOffset: number;
    /** The frame's vertical offset in the animation */
    yOffset: number;
    /**
     * @deprecated Use the name `'any'`: `Frame.DISPOSAL_*` and `FrameDisposalModes` are removed in 4.0
     * @group Deprecated
     */
    static readonly DISPOSAL_ANY: typeof FrameDisposalModes.ANY;
    /**
     * @deprecated Use the name `'keep'`: `Frame.DISPOSAL_*` and `FrameDisposalModes` are removed in 4.0
     * @group Deprecated
     */
    static readonly DISPOSAL_KEEP: typeof FrameDisposalModes.KEEP;
    /**
     * @deprecated Use the name `'previous'`: `Frame.DISPOSAL_*` and `FrameDisposalModes` are removed in 4.0
     * @group Deprecated
     */
    static readonly DISPOSAL_PREVIOUS: typeof FrameDisposalModes.PREVIOUS;
    /**
     * @deprecated Use the name `'background'`: `Frame.DISPOSAL_*` and `FrameDisposalModes` are removed in 4.0
     * @group Deprecated
     */
    static readonly DISPOSAL_BACKGROUND: typeof FrameDisposalModes.BACKGROUND;
    /**
     * Creates a new, blank frame
     * @param width The width in pixels
     * @param height The height in pixels
     * @param options See {@link FrameOptions}
     */
    constructor(width: number, height: number, options?: FrameOptions);
    /**
     * Creates a new, blank frame
     * @param width The width in pixels
     * @param height The height in pixels
     * @param duration The frame's duration (in ms)
     * @param xOffset The frame's offset on the x-axis
     * @param yOffset The frame's offset on the y-axis
     * @param disposalMode The frame's disposal mode
     * @deprecated Pass {@link FrameOptions} instead, the positional arguments will be removed in 4.0
     */
    constructor(width: number, height: number, duration?: number, xOffset?: number, yOffset?: number, disposalMode?: FrameDisposalModeName | FrameDisposalModeId);
    /**
     * The frame's disposal mode (`'any'`, `'keep'`, `'previous'` or `'background'`). Setting it by id (0-3) is deprecated,
     * the ids will be removed in 4.0
     */
    get disposalMode(): FrameDisposalModeName;
    /**
     * Sets the disposal mode
     * @param disposalMode The mode's name (`'any'`, `'keep'`, `'previous'`, `'background'`) or, deprecated, its id (0-3)
     */
    set disposalMode(disposalMode: FrameDisposalModeName | FrameDisposalModeId);
    /** A short description for debugging, e.g. `Frame<64x64x100ms>` */
    toString(): string;
    /**
     * Converts an Image instance to a Frame, cloning it in the process
     * @param image The image to create the frame from
     * @param options See {@link FrameOptions}
     */
    static from(image: Image, options?: FrameOptions): Frame;
    /**
     * Converts an Image instance to a Frame, cloning it in the process
     * @param image The image to create the frame from
     * @param duration The frame's duration (in ms)
     * @param xOffset The frame's offset on the x-axis
     * @param yOffset The frame's offset on the y-axis
     * @param disposalMode The frame's disposal mode
     * @deprecated Pass {@link FrameOptions} instead, the positional arguments will be removed in 4.0
     */
    static from(image: Image, duration?: number, xOffset?: number, yOffset?: number, disposalMode?: FrameDisposalModeName | FrameDisposalModeId): Frame;
    /**
     * Clones the frame, including its duration, offsets and disposal mode
     */
    clone(): Frame;
    /**
     * Removes borders of one color, moving the frame's offsets so the remaining pixels stay in place
     * @param options See {@link TrimOptions}
     */
    trim(options?: TrimOptions): this;
    /**
     * Removes borders of one color, moving the frame's offsets so the remaining pixels stay in place
     * @param color The border color, by default the color of the top left pixel
     * @param options See {@link TrimOptions}
     * @deprecated Pass {@link TrimOptions} instead, the positional arguments will be removed in 4.0
     */
    trim(color?: Color, options?: TrimOptions): this;
    /**
     * Resizes the frame, scaling its offsets along with it.
     * Pass {@link ResizeToOptions} with only a width or a height to keep the aspect ratio.
     * @param width The new width
     * @param height The new height
     * @param options See {@link ResizeOptions}
     */
    resize(width: number, height: number, options?: ResizeOptions): this;
    /**
     * Resizes the frame, scaling its offsets along with it.
     * @param width The new width
     * @param height The new height
     * @param mode The resizing mode (default: {@link ResizeModes.BILINEAR})
     * @deprecated Pass {@link ResizeOptions} with `mode` instead, the positional mode will be removed in 4.0
     */
    resize(width: number, height: number, mode?: ResizeMode): this;
    /**
     * Resizes the frame, scaling its offsets along with it: to the given width or height (the other side keeps the
     * aspect ratio), or to both
     * @param options The size and how to resize, see {@link ResizeToOptions}
     */
    resize(options: ResizeToOptions): this;
}
