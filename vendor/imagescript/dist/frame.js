import { Image, resizeArguments } from "./image.js";
import { isOptions, finite } from "./util/options.js";
const DISPOSAL_MODES = ['any', 'keep', 'previous', 'background'];
export class FrameDisposalModes {
    static ANY = 'any';
    static KEEP = 'keep';
    static PREVIOUS = 'previous';
    static BACKGROUND = 'background';
    constructor() { }
}
export class Frame extends Image {
    duration;
    xOffset;
    yOffset;
    __disposalMode__ = 1;
    static DISPOSAL_ANY = FrameDisposalModes.ANY;
    static DISPOSAL_KEEP = FrameDisposalModes.KEEP;
    static DISPOSAL_PREVIOUS = FrameDisposalModes.PREVIOUS;
    static DISPOSAL_BACKGROUND = FrameDisposalModes.BACKGROUND;
    static __convert_disposal_mode__(mode) {
        const id = typeof mode === 'string' ? DISPOSAL_MODES.indexOf(mode) : mode;
        if (!(id >= 0 && id <= 3))
            throw new RangeError('Invalid disposal mode');
        return id;
    }
    constructor(width, height, durationOrOptions, xOffset, yOffset, disposalMode) {
        const { duration = 100, xOffset: x = 0, yOffset: y = 0, disposalMode: disposal = FrameDisposalModes.KEEP } = isOptions(durationOrOptions) ? durationOrOptions : { duration: durationOrOptions, xOffset, yOffset, disposalMode };
        if (finite(duration, 'frame duration') < 0)
            throw new RangeError('Invalid frame duration');
        finite(x, 'x offset');
        finite(y, 'y offset');
        super(width, height);
        this.duration = duration;
        this.xOffset = x;
        this.yOffset = y;
        this.disposalMode = disposal;
    }
    get disposalMode() {
        return DISPOSAL_MODES[this.__disposalMode__];
    }
    get __disposal_id__() {
        return this.__disposalMode__;
    }
    set disposalMode(disposalMode) {
        this.__disposalMode__ = Frame.__convert_disposal_mode__(disposalMode);
    }
    toString() {
        return `Frame<${this.width}x${this.height}x${this.duration}ms>`;
    }
    static from(image, durationOrOptions, xOffset, yOffset, disposalMode) {
        if (!(image instanceof Image))
            throw new TypeError('Invalid image passed');
        const options = isOptions(durationOrOptions) ? durationOrOptions : { duration: durationOrOptions, xOffset, yOffset, disposalMode };
        const frame = new Frame(image.width, image.height, options);
        frame.bitmap.set(image.bitmap);
        return frame;
    }
    clone() {
        return Frame.from(this, { duration: this.duration, xOffset: this.xOffset, yOffset: this.yOffset, disposalMode: this.disposalMode });
    }
    __room__() {
        return { left: this.xOffset, top: this.yOffset };
    }
    __grown__(left, top) {
        this.xOffset -= left;
        this.yOffset -= top;
    }
    trim(colorOrOptions, optionsArgument = {}) {
        const { color, ...options } = isOptions(colorOrOptions) ? colorOrOptions : { ...optionsArgument, color: colorOrOptions ?? optionsArgument.color };
        const bounds = this.__trim_bounds__(color, options);
        if (!bounds)
            return this;
        this.xOffset += bounds[0];
        this.yOffset += bounds[1];
        return this.__apply__(this.__crop__(...bounds));
    }
    resize(widthOrOptions, heightArgument, modeArgument) {
        const [width, height, modeOrOptions] = resizeArguments(widthOrOptions, heightArgument, modeArgument);
        const originalWidth = this.width;
        const originalHeight = this.height;
        super.resize(width, height, modeOrOptions);
        this.xOffset = Math.round(this.xOffset * this.width / originalWidth);
        this.yOffset = Math.round(this.yOffset * this.height / originalHeight);
        return this;
    }
    __rescaled__(width, height) {
        this.xOffset = Math.round(this.xOffset * width / this.width);
        this.yOffset = Math.round(this.yOffset * height / this.height);
    }
}
