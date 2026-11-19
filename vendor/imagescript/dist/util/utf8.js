const encoder = new TextEncoder();
const decoder = new TextDecoder();
export function encode(text) {
    return encoder.encode(text);
}
export function decode(bytes) {
    return decoder.decode(bytes);
}
