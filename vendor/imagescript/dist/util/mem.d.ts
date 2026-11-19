/** Data accepted wherever binary input is expected */
export type BinaryData = ArrayBuffer | ArrayBufferView;
/**
 * Returns a Uint8Array view of the given buffer without copying
 */
export declare function view(buffer: BinaryData): Uint8Array;
/**
 * Concatenates byte arrays
 */
export declare function concat(parts: ArrayLike<number>[]): Uint8Array;
