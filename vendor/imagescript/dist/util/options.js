export function isOptions(value) {
    return typeof value === 'object' && value !== null && !ArrayBuffer.isView(value);
}
export function finite(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number))
        throw new RangeError(`Invalid ${name}: ${value}`);
    return number;
}
export function quality(value, name = 'quality') {
    const q = finite(value, name);
    if (q < 0 || q > 100)
        throw new RangeError(`${name} must be 0-100, not ${q}`);
    return q;
}
export function effort(value, max) {
    if (!Number.isInteger(value) || value < 0 || value > max)
        throw new RangeError(`effort must be an integer 0-${max}, not ${value}`);
    return value;
}
export const compressionLevel = (value) => Math.min(9, Math.max(0, ~~finite(value, 'compression level')));
export const color = (value, name = 'color') => finite(value, name);
const LOOP_LIMITS = { GIF: 65535, WebP: 65534, APNG: 2 ** 31 - 2 };
export function fitLoops(loopCount, format) {
    if (loopCount !== Infinity && loopCount > LOOP_LIMITS[format])
        throw new RangeError(`${format} stores loop counts up to ${LOOP_LIMITS[format]} (or Infinity to loop forever), not ${loopCount}`);
    return loopCount;
}
