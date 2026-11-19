import { Image } from "./image.js";
import { GIF } from "./gif.js";
import { Animation } from "./animation.js";
import { isOptions } from "./util/options.js";
import * as webp from "./codecs/webp.js";
import { view } from "./util/mem.js";
import { ImageType } from "./image-type.js";
export { Image, ResizeModes, SVGScaleModes } from "./image.js";
export { Colors } from "./colors.js";
export { Frame, FrameDisposalModes } from "./frame.js";
export { GainMap } from "./gainmap.js";
export { GIF } from "./gif.js";
export { Animation } from "./animation.js";
export { AnimationEncoder } from "./animation-encoder.js";
export { TextLayout } from "./text-layout.js";
export { ImageType } from "./image-type.js";
export function decode(data, onlyFirstFrameOrOptions = false) {
    const { onlyFirstFrame = false, applyOrientation, maxPixels, toneMapping } = isOptions(onlyFirstFrameOrOptions) ? onlyFirstFrameOrOptions : { onlyFirstFrame: onlyFirstFrameOrOptions };
    const type = ImageType.getType(data);
    if (type === 'gif')
        return GIF.decode(data, { onlyFirstFrame, maxPixels });
    if (type === 'webp' && webp.isAnimated(view(data)))
        return Animation.decode(data, { onlyFirstFrame, maxPixels });
    return Image.decode(data, { applyOrientation, maxPixels, toneMapping });
}
