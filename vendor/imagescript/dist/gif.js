import { view } from "./util/mem.js";
import { ImageType } from "./image-type.js";
import { Animation } from "./animation.js";
import { isOptions } from "./util/options.js";
export class GIF extends Animation {
    constructor(frames, loopCountOrOptions) {
        super(frames, loopCountOrOptions);
    }
    toString() {
        return `GIF<${this.width}x${this.height}x${this.duration}ms>`;
    }
    async encode(qualityOrOptions) {
        return this.encodeGIF(qualityOrOptions);
    }
    static async decode(input, onlyFirstFrameOrOptions = false) {
        const { onlyFirstFrame = false, maxPixels } = isOptions(onlyFirstFrameOrOptions) ? onlyFirstFrameOrOptions : { onlyFirstFrame: onlyFirstFrameOrOptions };
        const data = view(input);
        if (!ImageType.isGIF(new DataView(data.buffer, data.byteOffset, data.byteLength)))
            throw new Error('Unsupported image type');
        return Animation.__fromGIF__(data, onlyFirstFrame, GIF, maxPixels);
    }
}
