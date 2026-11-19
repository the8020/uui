export class LimitError extends RangeError {
}
export const MAX_PIXELS = 0x3fff * 0x3fff;
export function checkPixels(width, height, limit, count = 1) {
    if (!(width * height * count <= limit))
        throw new LimitError(`Image too large: ${count > 1 ? `${count} frames of ` : ''}${width}x${height} pixels exceed the limit of ${limit} (the decode options' maxPixels)`);
}
export const MAX_BYTES_PER_PIXEL = 8;
export function checkBytes(bytes, limit) {
    if (!(bytes <= limit * MAX_BYTES_PER_PIXEL))
        throw new LimitError(`Image too large: ${bytes} bytes of samples exceed what the limit of ${limit} pixels allows (the decode options' maxPixels)`);
}
export class PixelBudget {
    left;
    limit;
    constructor(limit) {
        this.limit = this.left = limit;
    }
    take(width, height) {
        this.left -= width * height;
        if (!(this.left >= 0))
            throw new LimitError(`Image too large: its frames exceed the limit of ${this.limit} pixels (the decode options' maxPixels)`);
    }
}
export async function decoding(decode) {
    try {
        return await decode();
    }
    catch (err) {
        if (err instanceof RangeError && !(err instanceof LimitError))
            throw new Error('Image: damaged or truncated image data', { cause: err });
        throw err;
    }
}
