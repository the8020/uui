/** Where lines are wrapped: between words or at any character */
export type WrapStyle = 'word' | 'char';
/** Alignment of the lines relative to the widest line */
export type HorizontalAlign = 'left' | 'center' | 'right';
/** Which lines to keep when the text is cut off at `maxHeight` */
export type VerticalAlign = 'top' | 'middle' | 'bottom';
/** Options of {@link TextLayout} */
export interface TextLayoutOptions {
    /** Longer lines are wrapped. Default: `Infinity` */
    maxWidth?: number;
    /** Lines that don't fit are cut off. Default: `Infinity` */
    maxHeight?: number;
    /** Whether to wrap between words or at any character. Default: `'word'` */
    wrapStyle?: WrapStyle;
    /**
     * Alignment of the lines relative to the widest line. Default: `'left'`
     * (before 3.0 this was called verticalAlign, the values of the other axis (`'top'`, `'middle'`, `'bottom'`) are
     * accepted for compatibility, which will be removed in 4.0)
     */
    horizontalAlign?: HorizontalAlign | VerticalAlign;
    /**
     * Which lines to keep when cutting off at `maxHeight`. Default: `'top'`
     * (before 3.0 this was called horizontalAlign, the values of the other axis (`'left'`, `'center'`, `'right'`) are
     * accepted for compatibility, which will be removed in 4.0)
     */
    verticalAlign?: VerticalAlign | HorizontalAlign;
    /** Whether to break lines at newline characters. Default: `true` */
    wrapHardBreaks?: boolean;
}
/**
 * Layout options for {@link Image.renderText}
 */
export declare class TextLayout {
    /** Longer lines are wrapped */
    maxWidth: number;
    /** Lines that don't fit are cut off */
    maxHeight: number;
    /** Whether to wrap between words or at any character */
    wrapStyle: WrapStyle;
    /** Alignment of the lines relative to the widest line */
    horizontalAlign: HorizontalAlign;
    /** Which lines to keep when cutting off at `maxHeight` */
    verticalAlign: VerticalAlign;
    /** Whether to break lines at newline characters */
    wrapHardBreaks: boolean;
    /**
     * Creates a layout, missing options take their defaults
     * @param options See {@link TextLayoutOptions}
     */
    constructor(options?: TextLayoutOptions);
}
