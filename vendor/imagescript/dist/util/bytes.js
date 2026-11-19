const fromBase64 = Uint8Array.fromBase64;
export function base64(text) {
    if (fromBase64)
        return fromBase64(text);
    const binary = atob(text), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}
export class ByteWriter {
    buffer;
    length = 0;
    constructor(capacity = 1024) {
        this.buffer = new Uint8Array(Math.max(16, capacity));
    }
    reserve(size) {
        if (this.length + size <= this.buffer.length)
            return;
        const buffer = new Uint8Array(Math.max(this.buffer.length * 2, this.length + size));
        buffer.set(this.buffer.subarray(0, this.length));
        this.buffer = buffer;
    }
    byte(value) {
        this.reserve(1);
        this.buffer[this.length++] = value;
    }
    bytes(...values) {
        this.reserve(values.length);
        for (const value of values)
            this.buffer[this.length++] = value;
    }
    array(values) {
        this.reserve(values.length);
        this.buffer.set(values, this.length);
        this.length += values.length;
    }
    finish() {
        return this.buffer.slice(0, this.length);
    }
}
