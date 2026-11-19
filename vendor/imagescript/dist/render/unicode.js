import { base64 } from "../util/bytes.js";
const decoded = new WeakMap();
function decode(property) {
    let ranges = decoded.get(property);
    if (ranges)
        return ranges;
    const numbers = varints(property.data);
    const count = numbers.length / 3;
    ranges = { starts: new Uint32Array(count), ends: new Uint32Array(count), values: new Uint8Array(count) };
    for (let i = 0, next = 0; i < count; i++) {
        const start = next + numbers[i * 3];
        ranges.starts[i] = start;
        ranges.ends[i] = start + numbers[i * 3 + 1];
        ranges.values[i] = numbers[i * 3 + 2];
        next = ranges.ends[i] + 1;
    }
    decoded.set(property, ranges);
    return ranges;
}
export function valueIndex(property, codepoint) {
    const { starts, ends, values } = decode(property);
    let lo = 0, hi = starts.length - 1;
    while (lo <= hi) {
        const mid = lo + hi >> 1;
        if (ends[mid] < codepoint)
            lo = mid + 1;
        else if (starts[mid] > codepoint)
            hi = mid - 1;
        else
            return values[mid];
    }
    return 0;
}
export function value(property, codepoint) {
    return property.names[valueIndex(property, codepoint)];
}
export function varints(data) {
    const bytes = base64(data), numbers = [];
    for (let i = 0, value = 0, shift = 1; i < bytes.length; i++) {
        value += (bytes[i] & 127) * shift;
        if (bytes[i] & 128)
            shift *= 128;
        else {
            numbers.push(value);
            value = 0;
            shift = 1;
        }
    }
    return numbers;
}
