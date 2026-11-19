export function view(buffer) {
    if (buffer instanceof Uint8Array && buffer.constructor === Uint8Array)
        return buffer;
    if (buffer instanceof ArrayBuffer)
        return new Uint8Array(buffer);
    if (ArrayBuffer.isView(buffer))
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer)
        return new Uint8Array(buffer);
    throw new TypeError('The provided value is not of type \'(ArrayBuffer or ArrayBufferView)\'');
}
export function concat(parts) {
    let length = 0;
    for (const part of parts)
        length += part.length;
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}
