/** How linear light brighter than white becomes 8 bit sRGB: tone mapped by Reinhard's operator, or clamped */
export type ToneMapping = 'reinhard' | 'clamp';
/**
 * Linear light RGB (3 values per pixel) as sRGB RGBA. Reinhard's extended operator ("Photographic Tone Reproduction
 * for Digital Images", 2002, equation 4) without its automatic exposure, which makes dark scenes like nights grey:
 * the luminance L becomes L (1 + L / Lw²) / (1 + L), the brightest pixel's (at least 1) Lw white, and the channels are
 * scaled by that, keeping their hue; images no brighter than white stay as they are
 */
export declare function toSRGB(rgb: Float32Array, toneMapping: ToneMapping): Uint8Array;
/** the white of SDR content in HDR (BT.2408, cd/m²): linear light 1 */
export declare const REFERENCE_WHITE = 203;
/**
 * Non-linear PQ (SMPTE ST 2084, transfer 16) or HLG (BT.2100, 18) RGB (3 values per pixel, primaries as CICP codes) as
 * linear light (in place) with BT.709 primaries, 1 being the reference white (203 cd/m²): HLG is displayed as on a
 * 1000 cd/m² display (BT.2100's OOTF, gamma 1.2)
 */
export declare function hdrToLinear(rgb: Float32Array, transfer: number, primaries: number): Float32Array;
/** Whether the data starts like a Radiance HDR */
export declare function isHDR(d: Uint8Array): boolean;
/** Decodes a Radiance HDR into RGBA */
export declare function decode(d: Uint8Array, maxPixels?: number, toneMapping?: ToneMapping): {
    width: number;
    height: number;
    pixels: Uint8Array;
};
