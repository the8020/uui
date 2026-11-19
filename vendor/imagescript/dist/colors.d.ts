import type { Color } from './image.d.ts';
/** Clamps and rounds a channel value to 0..255 */
export declare function channel(value: number): number;
export declare function wrapHue(h: number): number;
export declare function hue2rgb(p: number, q: number, t: number): number;
/**
 * Converts an RGBA value to an array of HSLA values
 * @param r {number} (0..255)
 * @param g {number} (0..255)
 * @param b {number} (0..255)
 * @param a {number} (0..255)
 * @returns The HSLA values ([H, S, L, A])
 */
export declare function rgbaToHSLA(r: number, g: number, b: number, a: number): [h: number, s: number, l: number, a: number];
/**
 * Conversions between RGBA, HSLA and the 32-bit color values ({@link Color}, `0xRRGGBBAA`) that the image methods take
 * and return, and gradients between colors
 */
export declare class Colors {
    private constructor();
    /**
     * Converts RGBA components to an RGBA value, values are rounded and clamped to 0..255
     * @param r red (0..255)
     * @param g green (0..255)
     * @param b blue (0..255)
     * @param a alpha (0..255)
     * @returns RGBA value
     */
    static fromRGBA(r: number, g: number, b: number, a: number): Color;
    /**
     * Converts RGB components to an RGBA value (assuming alpha = 255)
     * @param r red (0..255)
     * @param g green (0..255)
     * @param b blue (0..255)
     * @returns RGBA value
     */
    static fromRGB(r: number, g: number, b: number): Color;
    /**
     * Converts HSLA colors to RGBA colors
     * @param h hue (0..1)
     * @param s saturation (0..1)
     * @param l lightness (0..1)
     * @param a opacity (0..1)
     * @returns color
     */
    static fromHSLA(h: number, s: number, l: number, a: number): Color;
    /**
     * Converts HSL colors to RGBA colors (assuming an opacity of 255)
     * @param h hue (0..1)
     * @param s saturation (0..1)
     * @param l lightness (0..1)
     * @returns color
     */
    static fromHSL(h: number, s: number, l: number): Color;
    /**
     * Converts a color value to an array of RGBA values
     * @param color The color value to convert
     * @returns The RGBA values ([R, G, B, A])
     */
    static toRGBA(color: Color): [r: number, g: number, b: number, a: number];
    /**
     * Converts a color value to an array of RGB values (ignoring the colors alpha)
     * @param color The color value to convert
     * @returns The RGB values ([R, G, B])
     */
    static toRGB(color: Color): [r: number, g: number, b: number];
    /**
     * Converts a color to an array of HSLA values
     * @param color The color value to convert
     * @returns The HSLA values ([H, S, L, A]), H and S and L and A in 0..1
     */
    static toHSLA(color: Color): [h: number, s: number, l: number, a: number];
    /**
     * Creates a multi-point gradient generator
     * @param colors The gradient points to use (e.g. `{0: 0xff0000ff, 1: 0x00ff00ff}`)
     * @return The gradient generator. The function argument is the position in the gradient (0..1).
     */
    static gradient(colors: Record<number, Color>): (position: number) => Color;
}
