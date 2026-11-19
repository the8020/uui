import type { ToneMapping } from './codecs/hdr.d.ts';
import { BinaryData } from './util/mem.d.ts';
import { TextLayout, TextLayoutOptions } from './text-layout.d.ts';
import { Metadata } from './metadata.d.ts';
import { GainMap } from './gainmap.d.ts';
/** A color as a 32-bit RGBA integer (`0xRRGGBBAA`) */
export type Color = number;
/** Called with a pixel's (0-based) coordinates, returns its color */
export type ColorFunction = (x: number, y: number) => Color;
/**
 * Resampling filters for {@link Image.resize} and the other scaling functions, see {@link ResizeModes}.
 * The upper case names (`'RESIZE_BILINEAR'`, the values of the deprecated `Image.RESIZE_*`) still work, they are
 * removed in 4.0
 */
export type ResizeMode = 'nearest-neighbor' | 'bilinear' | 'bicubic' | 'area' | 'RESIZE_NEAREST_NEIGHBOR' | 'RESIZE_BILINEAR' | 'RESIZE_BICUBIC' | 'RESIZE_AREA';
/**
 * How {@link Image.renderSVG} scales, see {@link SVGScaleModes}. The numbers 1-3 (the values of the deprecated
 * `Image.SVG_MODE_*`) still work, they are removed in 4.0
 * @deprecated Use `renderSVG(svg, { width })`, `{ height }` or `{ scale }`: the `mode` option is removed in 4.0
 */
export type SVGScaleMode = 'scale' | 'width' | 'height' | 1 | 2 | 3;
/**
 * The resampling filters of {@link Image.resize} and the other scaling functions:
 * `image.resize({ width: 256, mode: ResizeModes.BICUBIC })`
 * @deprecated Use the names, `image.resize({ width: 256, mode: 'bicubic' })`: `ResizeModes` is removed in 4.0
 */
export declare class ResizeModes {
    /**
     * Use {@link https://en.wikipedia.org/wiki/Image_scaling#Nearest-neighbor_interpolation Nearest-neighbor} resizing
     */
    static readonly NEAREST_NEIGHBOR = "nearest-neighbor";
    /**
     * Bilinear resizing (the default). When shrinking, the filter widens with the scale factor, so every source pixel
     * contributes
     */
    static readonly BILINEAR = "bilinear";
    /** Bicubic (Catmull-Rom) resizing, sharper than bilinear, especially when enlarging */
    static readonly BICUBIC = "bicubic";
    /**
     * Area averaging (box filter): every output pixel is the average of the source pixels it covers. Meant for
     * shrinking
     */
    static readonly AREA = "area";
    /**
     * Not a filter: passed as the width or the height, that side follows from the other one, keeping the image's
     * aspect ratio
     * @deprecated Pass only the width or the height instead, `image.resize({ width: 256 })`. `AUTO` is removed in 4.0
     * @group Deprecated
     */
    static readonly AUTO = -1;
    private constructor();
}
/**
 * How {@link Image.renderSVG} scales the SVG to the given size
 * @deprecated Use `renderSVG(svg, { width })`, `{ height }` or `{ scale }`: `SVGScaleModes` and the `mode` option are
 *     removed in 4.0
 */
export declare class SVGScaleModes {
    /** The size is a factor of the SVG's own size */
    static readonly SCALE = "scale";
    /** The size is the width in pixels, the height follows the SVG's aspect ratio */
    static readonly WIDTH = "width";
    /** The size is the height in pixels, the width follows the SVG's aspect ratio */
    static readonly HEIGHT = "height";
    private constructor();
}
/** Blend modes of {@link Image.composite}, named like CSS' mix-blend-mode values */
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'add';
/** Options of {@link Image.composite} */
export interface CompositeOptions {
    /** The x position to place the source at, if the options are the second argument. Default: `0` */
    x?: number;
    /** The y position to place the source at, if the options are the second argument. Default: `0` */
    y?: number;
    /** Opacity of the source (0..1). Default: `1` */
    opacity?: number;
    /** How the colors are mixed. Default: `'normal'` */
    mode?: BlendMode;
}
/**
 * The size for {@link Image.resize}, {@link Frame.resize} and {@link Animation.resize}, and how to resize: a side
 * that is missing follows from the other one, keeping the aspect ratio
 */
export interface ResizeToOptions extends ResizeOptions {
    /** The new width. Without it, it follows from the height */
    width?: number;
    /** The new height. Without it, it follows from the width */
    height?: number;
}
/** Options of {@link Image.scale}, {@link Image.resize}, {@link Image.contain}, {@link Image.fit} and {@link Image.cover} */
export interface ResizeOptions {
    /** The resizing mode. Default: {@link ResizeModes.BILINEAR} */
    mode?: ResizeMode;
    /**
     * Whether to round to 8 bits between the two passes, so two channels share the multiplications of both: about
     * 15-25% faster for opaque images, with 10-25% of the channel values a step off the precise result (instead of
     * about 1%, never more than 1). Transparent images are premultiplied to 8 bits like browsers do, which makes them
     * about twice as fast: what shows once they're composited differs by up to about 2 steps, pixels that are almost
     * transparent keep less of their color. Only affects {@link ResizeModes.BILINEAR} and {@link ResizeModes.AREA},
     * down to about a third of the size. Default: `true`
     */
    fast?: boolean;
}
/**
 * Options of {@link Image.opacity}, {@link Image.red}, {@link Image.green}, {@link Image.blue}, {@link Image.lightness}
 * and {@link Image.saturation}
 */
export interface AdjustOptions {
    /**
     * Whether to set the value (true) or scale the current one (false). Default: `false`
     * @deprecated Removed in 4.0: scale with a factor, or use {@link Image.recolor} for a fixed color
     */
    absolute?: boolean;
}
/** Options of {@link Image.sharpen} */
export interface SharpenOptions {
    /** How strongly to sharpen (0 does nothing). Default: `1` */
    amount?: number;
    /** The radius of the blur the image is compared with (larger values sharpen coarser details). Default: `1` */
    radius?: number;
}
/** Options of {@link Image.quantize}: either `colors` or `palette`, and the dithering */
export interface QuantizeOptions {
    /**
     * The number of colors to reduce the image to, an integer from 2 to 256. The palette is the image's own colors when
     * it has no more distinct ones than this, else colors chosen by median cut (the common colors get their own). Those
     * are averages of groups of similar colors, so e.g. pure black and white are only in it if the image has them in
     * quantity: give `palette` for exact colors. Default: `256`. Give `colors` or `palette`, not both
     */
    colors?: number;
    /**
     * A fixed palette (1 to 256 colors, e.g. a Game Boy's four greens) that every pixel is mapped to, the nearest color
     * by its RGB. The alpha of the palette's colors is ignored. Give `palette` or `colors`, not both
     */
    palette?: Color[];
    /**
     * How the rounding error of each pixel is handled, which makes gradients look smooth with few colors:
     * `'none'` (each pixel takes its nearest color), `'floyd-steinberg'` (the error goes to the next pixels, 7/16, 3/16,
     * 5/16 and 1/16), `'atkinson'` (the error goes to six neighbours, 1/8 each: lighter, more contrast), `'ordered'` (a
     * regular 4x4 pattern of thresholds, no error spreading). Rows alternate direction for the error diffusions.
     * Default: `'none'`
     */
    dither?: 'none' | 'floyd-steinberg' | 'atkinson' | 'ordered';
    /**
     * How strongly to dither, from `0` (no spreading or threshold, the same as `'none'`) to `1` (the full error or
     * threshold). Default: `1`
     */
    ditherStrength?: number;
}
/** How {@link Image.transform} samples the pixels between the source's */
export type TransformMode = 'nearest-neighbor' | 'bilinear' | 'bicubic';
/** Options of {@link Image.transform} */
export interface TransformOptions {
    /**
     * The point the transform is applied around, in pixels: a rotation turns around it, a scale grows from it.
     * Default: the middle of the image. It only decides where the result lies on a canvas that stays as large as the
     * image (`expand: false`)
     */
    origin?: {
        /** The x position of the point in pixels. Default: half the width */
        x?: number;
        /** The y position of the point in pixels. Default: half the height */
        y?: number;
    };
    /**
     * Whether to make the image as large as the transformed one, which then fills it (a rotated image grows to fit its
     * corners, a skewed one gets wider). Without it, the image keeps its size and the parts outside are lost. Frames
     * only grow up and left as far as their offset allows. Default: `true`
     */
    expand?: boolean;
    /**
     * How the pixels between the source's are sampled: `'nearest-neighbor'` (hard pixels, no smoothing, for pixel art),
     * `'bilinear'` (smooth), `'bicubic'` (sharper, slower, can overshoot a little at hard edges). Default: `'bilinear'`
     */
    mode?: TransformMode;
}
/** Options of {@link Image.dropShadow} */
export interface ShadowOptions {
    /** How far to move the shadow to the right (negative values: to the left), in pixels. Default: `0` */
    x?: number;
    /** How far to move the shadow down (negative values: up), in pixels. Default: `0` */
    y?: number;
    /** How soft the shadow's edge is: the standard deviation of a gaussian blur in pixels, like {@link Image.blur}. Default: `0` */
    blur?: number;
    /** How far to grow the shadow's shape before blurring it, in pixels. Default: `0` */
    spread?: number;
    /** The shadow's color, its alpha is the shadow's opacity. Default: `0x00000080` (50% black) */
    color?: Color;
    /**
     * Whether to make the image larger so the shadow isn't cut off. Without it, the image keeps its size and the part
     * of the shadow outside is lost. Default: `true`
     */
    expand?: boolean;
}
/** Options of {@link Image.outline} */
export interface OutlineOptions {
    /** The outline's width in pixels. Default: `1` */
    width?: number;
    /** The outline's color. Default: `0x000000ff` */
    color?: Color;
    /**
     * Whether to make the image larger so the outline isn't cut off. Without it, the image keeps its size and the
     * outline is cut where the image ends. Default: `true`
     */
    expand?: boolean;
}
/** The colors of a gradient, see {@link Image.linearGradient} */
export interface GradientOptions {
    /**
     * The colors along the gradient: their positions (0..1) and colors, like {@link Colors.gradient} takes them
     * (`{ 0: 0xff0000ff, 0.5: 0xffff00ff, 1: 0x00ff00ff }`), or just the colors, evenly spaced
     * (`[0xff0000ff, 0x00ff00ff]`)
     */
    stops: Record<number, Color> | Color[];
}
/** Options of {@link Image.linearGradient} */
export interface LinearGradientOptions extends GradientOptions {
    /**
     * The direction of the gradient in degrees, like CSS' `linear-gradient()`: `0` goes up, `90` to the right, `180`
     * down, `270` to the left. The first stop is at the start of the line through the center that touches the
     * corners. Default: `180`
     */
    angle?: number;
}
/** Options of {@link Image.radialGradient} */
export interface RadialGradientOptions extends GradientOptions {
    /** The x position of the center in pixels. Default: the middle of the image */
    x?: number;
    /** The y position of the center in pixels. Default: the middle of the image */
    y?: number;
    /** The radius of the last stop in pixels. Default: the distance to the farthest corner */
    radius?: number;
}
/** Options of {@link Image.encode} */
export interface PNGEncodeOptions {
    /** The compression level (0-9), higher is smaller but slower. Default: `4` */
    compression?: number;
    /** Metadata to include, see {@link Metadata} */
    metadata?: Metadata;
}
/** Options of {@link Image.encodeJPEG} */
export interface JPEGEncodeOptions {
    /** The JPEG quality (1-100), chroma subsampling is disabled above 90. Default: `90` */
    quality?: number;
    /** Metadata to include, see {@link Metadata} */
    metadata?: Metadata;
    /**
     * Whether to write the image's {@link Image.gainMap} (an Ultra HDR JPEG, brighter on HDR displays), or how.
     * Default: `true` (written if there is one)
     */
    gainMap?: boolean | {
        /** The map's JPEG quality (1-100). Default: `90` */
        quality?: number;
        /** The map's size as a factor of the image's (0-1). Default: the map's own size */
        scale?: number;
    };
}
/** Options of {@link Image.encodeWebP} */
export interface WebPEncodeOptions {
    /**
     * Lossy compression (0-100, like libwebp's quality: 75 is its default): the image is encoded like cwebp encodes it
     * (with `-m` set to the effort), much smaller than lossless. Without it the image is encoded losslessly
     */
    quality?: number;
    /**
     * How much effort compression takes (0-6): higher is smaller but slower. Lossy (libwebp's method): 0-2 pick the
     * predictions by how close they are, 3 and up also by how many bits they take, 5 and 6 also optimize the
     * quantized values; the default `2` takes about a quarter of the time of 4 (cwebp's default) for files about 5%
     * larger. Lossless: 0 is a fast mode (photos in about a fifth of the time, graphics in about a third, files about
     * 6-8% larger), 1 takes about two thirds of the time for files up to 2% larger, 2 and up compress the most.
     * Default: `2`
     */
    effort?: number;
    /**
     * For lossy compression: convert to YUV like libwebp's sharp conversion (cwebp's `-sharp_yuv`, the same file),
     * which picks the color planes so that colored edges (red text on blue, thin colored lines) stay sharp instead of
     * bleeding. It takes about twice the time at the default effort; photos get about as large, images with many
     * hard color edges a lot larger (1200x800 red and blue squares: 2.7 times). Default: `false`
     */
    sharpYuv?: boolean;
    /**
     * For lossy compression, the alpha plane's quality (0-100, like cwebp's `-alpha_q`): below 100 its levels are
     * reduced (to 2-16 up to 70, 16-256 above), which makes it compress better; the alpha plane is lossless otherwise.
     * Default: `100`
     */
    alphaQuality?: number;
    /**
     * For lossless compression, at most this many worker threads search the predictors and prefix codes in parallel
     * (the same file, faster), `1` for none. Images under about 1.5 megapixels, and runtimes whose workers can't share
     * memory (browsers without cross-origin isolation), encode without them. Default: the processors available, at
     * most 8
     */
    threads?: number;
    /** Metadata to include, see {@link Metadata} */
    metadata?: Metadata;
}
/** Options of {@link Image.encodeTGA} */
export interface EncodeOptions {
    /** Metadata to include, see {@link Metadata} */
    metadata?: Metadata;
}
/** Options of {@link Image.roundCorners} */
export interface RoundCornersOptions {
    /** The radius of the corners. Default: a quarter of the smaller side */
    radius?: number;
}
/** Options of {@link Image.fisheye} */
export interface FisheyeOptions {
    /** The distortion strength (exponent of the radial mapping), higher values bulge the center more. Default: `2` */
    strength?: number;
}
/** Options of {@link Image.renderSVG}: {@link SVGOptions}, by its name in 4.0 */
export type RenderSVGOptions = SVGOptions;
/** Options of {@link Image.renderSVG} */
export interface SVGOptions {
    /** The width in pixels, the height follows the SVG's aspect ratio. Only one of `width`, `height` and `scale` */
    width?: number;
    /** The height in pixels, the width follows the SVG's aspect ratio. Only one of `width`, `height` and `scale` */
    height?: number;
    /** A factor of the SVG's own size. Only one of `width`, `height` and `scale`. Default: `1` */
    scale?: number;
    /**
     * The scale, or the width or height in pixels, see `mode`. Default: `1`
     * @deprecated Use `width`, `height` or `scale`, their names in 4.0, which ignores `size` and `mode`:
     *     `renderSVG(svg, { width: 512 })`
     */
    size?: number;
    /**
     * What `size` is: one of {@link SVGScaleModes.SCALE}, {@link SVGScaleModes.WIDTH}, {@link SVGScaleModes.HEIGHT}.
     * Default: {@link SVGScaleModes.SCALE}
     * @deprecated Use `width`, `height` or `scale`, their names in 4.0, which ignores `size` and `mode`:
     *     `renderSVG(svg, { width: 512 })`
     */
    mode?: SVGScaleMode;
    /**
     * Fonts for `<text>`, like {@link SVGOptions.fonts}: one font, or several
     */
    font?: BinaryData | BinaryData[];
    /**
     * Fonts for `<text>` (TrueType, OpenType): each text gets the face its `font-family`, `font-weight`, `font-style`
     * and `font-stretch` match best among them, by the names, weights and styles in the fonts (like browsers match
     * installed fonts). Generic families (`serif`, `sans-serif`, `monospace`, ...) are the first font that fits them,
     * other families and text without one get the first font's family; characters a face doesn't have come from the
     * other fonts (TrueType, OpenType or WOFF). Fonts the SVG embeds with `@font-face` (in data: URIs) are used too,
     * before these for their family names. Without any fonts text isn't rendered. Default: `[]`
     * @deprecated Use `font`, its name in 4.0, which ignores `fonts` (one font, or several in an array)
     */
    fonts?: BinaryData[];
    /**
     * Images for the `<image>` elements (and `feImage`) by their `href`, the same string the SVG uses: with
     * `images: { 'logo.png': bytes }`, `<image href="logo.png" .../>` draws the image. Values are encoded images (PNG,
     * JPEG, WebP, GIF's first frame, ...) or {@link Image}s, decoded like data URI images are, and only for the hrefs
     * the SVG references. Nothing else is read: no files and no URLs, so an href that isn't given (and isn't a data URI)
     * draws nothing. SVG documents can't be given this way, use a data URI for them. Default: `{}`
     */
    images?: Record<string, BinaryData | Image>;
}
/** Options of {@link Image.renderText}: the text color and layout, and its style (see {@link TextStyle}) */
export interface TextOptions extends TextStyle {
    /** The text color. Default: `0xffffffff` */
    color?: Color;
    /** The text layout. Default: `new TextLayout()` */
    layout?: TextLayout;
}
/** Options of {@link Image.renderText}: the font and size, the text color and layout, and its style (see {@link TextStyle}) */
export interface RenderTextOptions extends TextStyle {
    /**
     * TrueType (ttf/ttc), OpenType (otf) or WOFF font buffer to use, or several by priority: every character comes
     * from the first font that has it (e.g. `[text, emoji]`), the first one sets the line height. Color glyphs (COLR
     * layers and paints, CBDT and sbix bitmaps, as in emoji fonts) keep their colors. Text in any script is shaped
     * like browsers do (right to left and bidirectional text, Arabic joining, Indic conjuncts, marks)
     */
    font: BinaryData | BinaryData[];
    /** Font size in pixels (per em) */
    size: number;
    /** The text color. Default: `0xffffffff` */
    color?: Color;
    /** The text layout, as {@link TextLayoutOptions} or a {@link TextLayout}. Default: the defaults of `TextLayout` */
    layout?: TextLayoutOptions | TextLayout;
}
/** Options of {@link Image.decode} */
export interface DecodeOptions {
    /** Whether to rotate/mirror JPEGs, TIFFs, PNGs and WebPs as their orientation tag (Exif or XMP) says. Default: `true` */
    applyOrientation?: boolean;
    /**
     * Whether to convert the colors of images with an embedded ICC profile (PNG, JPEG, WebP, AVIF, JPEG XL, TIFF), and
     * of AVIFs with other color primaries than sRGB's (Display P3, BT.2020), to sRGB, like browsers show them: wide
     * gamut photos (Display P3 from phones, Adobe RGB, ProPhoto) look as intended instead of washed out. Matrix/TRC
     * profiles (RGB and gray) are applied, relative colorimetric (colors outside sRGB are clipped); profiles with only
     * lookup tables, CMYK ones and ones that are sRGB anyway leave the pixels as they are. Default: `true`
     */
    applyColorProfile?: boolean;
    /**
     * The most pixels to decode: larger images throw a RangeError before anything that size is allocated, so small
     * files declaring huge images (decompression bombs) can't exhaust the memory. Default: `268402689` (16383², like
     * sharp), `Infinity` for no limit
     */
    maxPixels?: number;
    /**
     * How Radiance HDRs, PFMs and HDR (PQ or HLG) AVIFs and JPEG XLs, whose light can be brighter than (SDR) white,
     * become 8 bit sRGB: `'reinhard'` compresses the brightest parts like Reinhard's tone mapping operator does (the
     * brightest pixel becomes white, images no brighter than white stay as they are), `'clamp'` clamps everything
     * brighter than white. Default: `'reinhard'`
     */
    toneMapping?: ToneMapping;
    /**
     * Whether to read the gain maps of JPEGs (Ultra HDR, JPEG-R, ISO 21496-1, Apple's), AVIFs (tone mapped items) and
     * JPEG XLs (jhgm boxes) into {@link Image.gainMap}. Default: `true`
     */
    gainMap?: boolean;
    /**
     * At most this many worker threads decode in parallel (lossy JPEG XLs from 4 megapixels on, one per 2 megapixels
     * at most, lossless ones from 1.5 megapixels and 512 KiB on; AVIFs from 4 megapixels on: the conversion to RGB,
     * one per megapixel, and the tiles of grids), `1` for none. Default: the processors available, at most 8 (1 where
     * workers can't share memory)
     */
    threads?: number;
}
/** Options of {@link Image.encodeJXL} */
export interface JXLEncodeOptions {
    /**
     * Lossy compression (0-100, like cjxl's `-q`: 90 is visually lossless, 100 lossless): higher is better and larger.
     * Without it the image is encoded losslessly
     */
    quality?: number;
    /**
     * How hard compression works: 0-2, faster to smaller. Lossy: 0 uses 8x8 DCTs only (like `cjxl -e 3`), 1 and 2
     * search their sizes like `cjxl -e 5` (2 tries more of the small ones), and 2 also stores text-like features that
     * repeat (the glyphs of screenshots) once, as patches like `cjxl -e 7`. Lossless: 0 is `cjxl -e 1`'s fast mode
     * (byte for byte), 1 and 2 like `cjxl -e 3` (about 15% smaller for photos, 13% for graphics; a few times slower).
     * Default: `1`
     */
    effort?: number;
    /**
     * At most this many worker threads compress in parallel (the same file, faster: lossy 2.3 times with 8 on a
     * 1920x1080 photo at effort 1, 3.8 times on 3840x2160; lossless 2.8 and 4.3 times), `1` for none. Small images
     * (lossy under about 1.5 megapixels at effort 0, 512x512 pixels at 1, 384x384 at 2; lossless under 724x724 and
     * always at effort 0), and runtimes whose workers can't share memory (browsers without cross-origin isolation)
     * encode without them.
     * Default: the processors available, at most 8
     */
    threads?: number;
    /** Metadata to include, see {@link Metadata} */
    metadata?: Metadata;
    /**
     * Whether to write the image's {@link Image.gainMap} (brighter on HDR displays: a jhgm box, like libjxl's), or how.
     * Default: `true` (written if there is one)
     */
    gainMap?: boolean | {
        /** The map's quality (1-100 like `quality`, 100 lossless). Default: `90` */
        quality?: number;
        /** The map's size as a factor of the image's (0-1). Default: the map's own size */
        scale?: number;
    };
}
/** Options of {@link Image.encodeAVIF} */
export interface AVIFEncodeOptions {
    /** 0-100, like avifenc's: higher is better and larger, 100 is lossless. Default: `60` */
    quality?: number;
    /** The quality of the alpha channel (if the image has transparency), like avifenc's. Default: `100` (lossless) */
    alphaQuality?: number;
    /** Chroma subsampling: `'4:4:4'` keeps the full color resolution, `'4:2:0'` halves it (smaller). Default: `'4:4:4'` */
    subsampling?: '4:4:4' | '4:2:0';
    /** How hard the encoder searches for the best modes: 0-2, faster to smaller. Default: `1` */
    effort?: number;
    /**
     * At most this many worker threads encode in parallel (the same file, faster: 2.9 times with 8 on a 1920x1080
     * photo at effort 1), `1` for none. Small images (under about 640x640 pixels at effort 0, 448x448 at 1, 320x320
     * at 2), and runtimes whose workers can't share memory (browsers without cross-origin isolation), encode without
     * them. Default: the processors available, at most 8
     */
    threads?: number;
    /** Metadata to include, see {@link Metadata} */
    metadata?: Metadata;
    /**
     * Whether to write the image's {@link Image.gainMap} (brighter on HDR displays: a tone mapped item, like libavif
     * writes), or how. Default: `true` (written if there is one)
     */
    gainMap?: boolean | {
        /** The map's quality (1-100). Default: `90` */
        quality?: number;
        /** The map's size as a factor of the image's (0-1). Default: the map's own size */
        scale?: number;
    };
}
/** Text style options of {@link Image.renderText} */
export interface TextStyle {
    /** Width of an outline around the glyphs in pixels. Default: `0` */
    strokeWidth?: number;
    /** Color of the outline. Default: `0x000000ff` */
    strokeColor?: Color;
    /**
     * Whether to run the hinting instructions of TrueType fonts, which align stems and edges with the pixel grid for
     * crisper text at small sizes (like Windows renders text); the glyphs of hinted fonts are then placed on whole
     * pixels. Fonts without instructions (and CFF/OpenType outlines) aren't affected. Default: `true`
     */
    hinting?: boolean;
    /**
     * OpenType features by their tags, for the whole text: `true` turns one on (like `tnum` for tabular numbers,
     * `smcp` for small caps, `ss01` for a stylistic set), `false` off (also the ones on by default, like `liga` or
     * `kern`), a number picks an alternate (`salt: 2`). Fonts without a feature ignore it. Default: `{}`
     */
    features?: Record<string, boolean | number>;
    /**
     * The instance of variable fonts, by their axes: `weight` (1-1000, like CSS's `font-weight`: 400 regular, 700
     * bold), `width` (percent of the normal width: 75 condensed, 125 expanded), `slant` (degrees, negative leans
     * right), `italic` (`true`/`false`), `opticalSize` (the size the glyphs are designed for, in pixels; default: the
     * font size, like browsers' `font-optical-sizing: auto`), and other axes by their 4-character tag (like Roboto
     * Flex's `GRAD: 50`). Values outside an axis's range are clamped, axes a font doesn't have are ignored, fonts
     * without axes aren't affected. Default: `{}` (the fonts' default instances)
     */
    variations?: Record<string, number | boolean>;
}
/** Options of {@link Image.cropCircle} */
export interface CropCircleOptions {
    /**
     * The circle's size: `'contain'` fits it inside the image (the smaller dimension is its diameter, no hard edges),
     * `'cover'` covers the image (the larger dimension is its diameter, the corners of a rectangular image stay
     * transparent on the shorter side). Default: `'contain'`
     */
    fit?: 'contain' | 'cover';
    /**
     * The circle's size, like {@link CropCircleOptions.fit}
     * @deprecated Use `fit`, its name in 4.0, which ignores `size`: `cropCircle({ fit: 'cover' })`
     */
    size?: 'contain' | 'cover';
    /**
     * Whether to use the larger dimension for the size. Default: `false`
     * @deprecated Use `fit: 'cover'` (`true`) or `fit: 'contain'` (`false`), `max` will be removed in 4.0
     */
    max?: boolean;
    /** Share of the radius (0..1) over which the edge fades out. Default: `0` */
    feathering?: number;
}
/** Options of {@link Image.dominantColor} */
export interface DominantColorOptions {
    /** Whether to ignore dark colors (all channels below the threshold). Default: `true` */
    ignoreBlack?: boolean;
    /** Whether to ignore light colors (all channels above 255 minus the threshold). Default: `true` */
    ignoreWhite?: boolean;
    /** The black/white threshold (0-64, in steps of 4 channel values). Default: `15` */
    threshold?: number;
}
/** Options of {@link Image.rotate} */
export interface RotateOptions {
    /** Whether to resize the image so it fits all pixels or just ignore outlying pixels. Default: `true` */
    resize?: boolean;
    /**
     * Whether to sample with 8-bit weights on 8-bit premultiplied pixels (like {@link ResizeOptions.fast}), about twice
     * as fast: opaque pixels stay within a step of the precise result, what shows of translucent ones (also the
     * faded edges) within about 2.5 steps (pixels that are almost transparent keep less of their color). Only affects
     * angles that aren't multiples of 90°. Default: `true`
     */
    fast?: boolean;
}
/** Options of {@link Image.trim} */
export interface TrimOptions {
    /**
     * The border color, by default the color of the top left pixel. Fully transparent pixels count as the same color
     * whatever their RGB values
     */
    color?: Color;
    /**
     * How far (0-1) a pixel's channels may be from the color for it to be trimmed, e.g. for JPEG artifacts or
     * antialiasing. Default: `0`
     */
    tolerance?: number;
}
/** Options of {@link Image.colorToAlpha} */
export interface ColorToAlphaOptions {
    /** The color to remove, by default the color of the top left pixel (e.g. a background) */
    color?: Color;
    /** Pixels at most this far from the color (0-1) become fully transparent. Default: 0 */
    transparencyThreshold?: number;
    /** Pixels at least this far from the color (0-1) stay fully opaque. Default: 1 */
    opacityThreshold?: number;
}
/**
 * Text metadata written into PNGs
 * @deprecated Use {@link Metadata}, which all encoders take
 * @group Deprecated
 */
export type PNGMetadata = Metadata;
/**
 * An RGBA image; provides the codecs and the manipulation functions. Methods that change the image modify it in place
 * and return it, so calls can be chained
 */
export declare class Image {
    /**
     * Creates a new image with the given dimensions, all pixels transparent black
     * @param width The width in pixels
     * @param height The height in pixels
     */
    constructor(width: number, height: number);
    /**
     * The image's gain map, if it has one (JPEGs from phones, Ultra HDR): how much brighter each part gets on HDR
     * displays. {@link Image.encodeJPEG} writes it. `null` removes it
     */
    get gainMap(): GainMap | null;
    /**
     * Replaces the gain map
     * @param gainMap The new gain map, or `null` to remove it
     */
    set gainMap(gainMap: GainMap | null);
    /**
     * The image's RGBA pixel data. It can be replaced by any 8-bit array with width * height * 4 bytes
     * (it is used as is, without copying)
     */
    get bitmap(): Uint8ClampedArray;
    /**
     * Replaces the pixel data
     * @param bitmap The new RGBA data, width * height * 4 bytes (used as is, without copying)
     */
    set bitmap(bitmap: Uint8ClampedArray | Uint8Array);
    /** A short description for debugging, e.g. `Image<64x64>` */
    toString(): string;
    /**
     * The images width
     */
    get width(): number;
    /**
     * The images height
     */
    get height(): number;
    /**
     * Yields an [x, y] array for every pixel in the image (0-based), row by row
     * @yields The coordinates of the pixel ([x, y])
     * @deprecated Use {@link Image.pixels}, which yields `[x, y, color]`: `coordinates()` will be removed in 4.0
     * @group Deprecated
     */
    coordinates(): Generator<[x: number, y: number], void, undefined>;
    /**
     * Yields an [x, y, color] array for every pixel in the image (0-based), row by row
     * @yields The coordinates and color of the pixel ([x, y, color])
     */
    pixels(): Generator<[x: number, y: number, color: Color], void, undefined>;
    /**
     * Yields an [x, y] array for every pixel in the image (0-based)
     * @yields The coordinates of the pixel ([x, y])
     * @deprecated Use {@link Image.pixels}, which yields `[x, y, color]`: iterating over the image will be removed in 4.0
     * @group Deprecated
     */
    [Symbol.iterator](): Generator<[x: number, y: number], void, undefined>;
    /**
     * Yields an [x, y, color] array for every pixel in the image (0-based)
     * @yields The coordinates and color of the pixel ([x, y, color])
     * @deprecated Use {@link Image.pixels}, `iterateWithColors()` will be removed in 4.0
     * @group Deprecated
     */
    iterateWithColors(): Generator<[x: number, y: number, color: Color], void, undefined>;
    /**
     * Converts RGBA components to an RGBA value, values are rounded and clamped to 0..255
     * @param r red (0..255)
     * @param g green (0..255)
     * @param b blue (0..255)
     * @param a alpha (0..255)
     * @deprecated Use {@link Colors.fromRGBA}, `Image.rgbaToColor` will be removed in 4.0
     * @group Deprecated
     */
    static rgbaToColor(r: number, g: number, b: number, a: number): Color;
    /**
     * Converts RGB components to an RGBA value (assuming alpha = 255)
     * @param r red (0..255)
     * @param g green (0..255)
     * @param b blue (0..255)
     * @deprecated Use {@link Colors.fromRGB}, `Image.rgbToColor` will be removed in 4.0
     * @group Deprecated
     */
    static rgbToColor(r: number, g: number, b: number): Color;
    /**
     * Converts HSLA colors to RGBA colors
     * @param h hue (0..1)
     * @param s saturation (0..1)
     * @param l lightness (0..1)
     * @param a opacity (0..1)
     * @deprecated Use {@link Colors.fromHSLA}, `Image.hslaToColor` will be removed in 4.0
     * @group Deprecated
     */
    static hslaToColor(h: number, s: number, l: number, a: number): Color;
    /**
     * Converts HSL colors to RGBA colors (assuming an opacity of 255)
     * @param h hue (0..1)
     * @param s saturation (0..1)
     * @param l lightness (0..1)
     * @deprecated Use {@link Colors.fromHSL}, `Image.hslToColor` will be removed in 4.0
     * @group Deprecated
     */
    static hslToColor(h: number, s: number, l: number): Color;
    /**
     * Converts an RGBA value to an array of HSLA values
     * @param r red (0..255)
     * @param g green (0..255)
     * @param b blue (0..255)
     * @param a alpha (0..255)
     * @deprecated Use {@link Colors.toHSLA}, `Image.rgbaToHSLA` will be removed in 4.0
     * @group Deprecated
     */
    static rgbaToHSLA(r: number, g: number, b: number, a: number): [h: number, s: number, l: number, a: number];
    /**
     * Converts a color value to an array of RGBA values
     * @param color The color value to convert
     * @deprecated Use {@link Colors.toRGBA}, `Image.colorToRGBA` will be removed in 4.0
     * @group Deprecated
     */
    static colorToRGBA(color: Color): [r: number, g: number, b: number, a: number];
    /**
     * Converts a color value to an array of RGB values (ignoring the colors alpha)
     * @param color The color value to convert
     * @deprecated Use {@link Colors.toRGB}, `Image.colorToRGB` will be removed in 4.0
     * @group Deprecated
     */
    static colorToRGB(color: Color): [r: number, g: number, b: number];
    /**
     * Creates an image with a linear gradient, like CSS' `linear-gradient()`
     * @param width The image's width
     * @param height The image's height
     * @param options The colors and the direction, see {@link LinearGradientOptions}
     * @returns The new image
     */
    static linearGradient(width: number, height: number, options: LinearGradientOptions): Image;
    /**
     * Creates an image with a radial (circular) gradient, like CSS' `radial-gradient(circle)`
     * @param width The image's width
     * @param height The image's height
     * @param options The colors and the circle, see {@link RadialGradientOptions}
     * @returns The new image
     */
    static radialGradient(width: number, height: number, options: RadialGradientOptions): Image;
    /**
     * Creates a multi-point gradient generator
     * @param colors The gradient points to use (e.g. `{0: 0xff0000ff, 1: 0x00ff00ff}`)
     * @deprecated Use {@link Colors.gradient}, `Image.gradient` will be removed in 4.0
     * @group Deprecated
     */
    static gradient(colors: Record<number, Color>): (position: number) => Color;
    /**
     * Gets the pixel color at the specified position (0-based)
     * @param x The x coordinate
     * @param y The y coordinate
     * @returns The color value (`0xRRGGBBAA`)
     */
    getPixelAt(x: number, y: number): Color;
    /**
     * Gets a view of the RGBA components of the pixel at the specified position (0-based)
     * @param x The x coordinate
     * @param y The y coordinate
     * @returns The pixel's 4 bytes in {@link Image.bitmap}: writing to them changes the pixel
     */
    getRGBAAt(x: number, y: number): Uint8ClampedArray;
    /**
     * Sets the pixel color for the specified position (0-based)
     * @param x The x coordinate
     * @param y The y coordinate
     * @param pixelColor The new color (`0xRRGGBBAA`)
     */
    setPixelAt(x: number, y: number, pixelColor: Color): this;
    /**
     * Fills the image data with the supplied color
     * @param color The color, or a function returning the color of each pixel
     */
    fill(color: Color | ColorFunction): this;
    /**
     * Clones the current image
     */
    clone(): Image;
    /**
     * @deprecated Use the name `'nearest-neighbor'`: `Image.RESIZE_*` and `ResizeModes` are removed in 4.0
     * @group Deprecated
     */
    static readonly RESIZE_NEAREST_NEIGHBOR = "RESIZE_NEAREST_NEIGHBOR";
    /**
     * @deprecated Use the name `'bilinear'`: `Image.RESIZE_*` and `ResizeModes` are removed in 4.0
     * @group Deprecated
     */
    static readonly RESIZE_BILINEAR = "RESIZE_BILINEAR";
    /**
     * @deprecated Use the name `'bicubic'`: `Image.RESIZE_*` and `ResizeModes` are removed in 4.0
     * @group Deprecated
     */
    static readonly RESIZE_BICUBIC = "RESIZE_BICUBIC";
    /**
     * @deprecated Use the name `'area'`: `Image.RESIZE_*` and `ResizeModes` are removed in 4.0
     * @group Deprecated
     */
    static readonly RESIZE_AREA = "RESIZE_AREA";
    /**
     * @deprecated Pass only the width or the height instead, `image.resize({ width: 256 })`. `Image.RESIZE_*` will
     *     be removed in 4.0
     * @group Deprecated
     */
    static readonly RESIZE_AUTO: typeof ResizeModes.AUTO;
    /**
     * Resizes the image by the given factor
     * @param factor The factor to resize the image with
     * @param options See {@link ResizeOptions}
     */
    scale(factor: number, options?: ResizeOptions): this;
    /**
     * Resizes the image by the given factor
     * @param factor The factor to resize the image with
     * @param [mode=ResizeModes.BILINEAR] The resizing mode to use
     * @deprecated Pass {@link ResizeOptions} with `mode` instead, the positional mode will be removed in 4.0
     */
    scale(factor: number, mode?: ResizeMode): this;
    /**
     * Resizes the image to the given dimensions.
     * Pass {@link ResizeToOptions} with only a width or a height to keep the aspect ratio.
     * @param width The new width
     * @param height The new height
     * @param options See {@link ResizeOptions}
     * @returns The resized image
     */
    resize(width: number, height: number, options?: ResizeOptions): this;
    /**
     * Resizes the image to the given dimensions.
     * Pass {@link ResizeToOptions} with only a width or a height to keep the aspect ratio.
     * @param width The new width
     * @param height The new height
     * @param [mode=ResizeModes.BILINEAR] The resizing mode to use
     * @returns The resized image
     * @deprecated Pass {@link ResizeOptions} with `mode` instead, the positional mode will be removed in 4.0
     */
    resize(width: number, height: number, mode?: ResizeMode): this;
    /**
     * Resizes the image: to the given width or height (the other side keeps the aspect ratio), or to both
     * @param options The size and how to resize, see {@link ResizeToOptions}
     * @returns The resized image
     */
    resize(options: ResizeToOptions): this;
    /**
     * Resizes the image so it is contained in the given bounding box.
     * Can return an image with one axis smaller than the given bounding box.
     * @param width The width of the bounding box
     * @param height The height of the bounding box
     * @param options See {@link ResizeOptions}
     * @returns The resized image
     */
    contain(width: number, height: number, options?: ResizeOptions): this;
    /**
     * Resizes the image so it is contained in the given bounding box.
     * Can return an image with one axis smaller than the given bounding box.
     * @param width The width of the bounding box
     * @param height The height of the bounding box
     * @param [mode=ResizeModes.BILINEAR] The resizing mode to use
     * @returns The resized image
     * @deprecated Pass {@link ResizeOptions} with `mode` instead, the positional mode will be removed in 4.0
     */
    contain(width: number, height: number, mode?: ResizeMode): this;
    /**
     * Resizes the image so it is contained in the given bounding box, placing it in the center of the given bounding box.
     * Always returns the exact dimensions of the bounding box.
     * @param width The width of the bounding box
     * @param height The height of the bounding box
     * @param options See {@link ResizeOptions}
     * @returns The resized image
     */
    fit(width: number, height: number, options?: ResizeOptions): this;
    /**
     * Resizes the image so it is contained in the given bounding box, placing it in the center of the given bounding box.
     * Always returns the exact dimensions of the bounding box.
     * @param width The width of the bounding box
     * @param height The height of the bounding box
     * @param [mode=ResizeModes.BILINEAR] The resizing mode to use
     * @returns The resized image
     * @deprecated Pass {@link ResizeOptions} with `mode` instead, the positional mode will be removed in 4.0
     */
    fit(width: number, height: number, mode?: ResizeMode): this;
    /**
     * Resizes the image so it covers the given bounding box, cropping the overflowing edges.
     * Always returns the exact dimensions of the bounding box.
     * @param width The width of the bounding box
     * @param height The height of the bounding box
     * @param options See {@link ResizeOptions}
     * @returns The resized image
     */
    cover(width: number, height: number, options?: ResizeOptions): this;
    /**
     * Resizes the image so it covers the given bounding box, cropping the overflowing edges.
     * Always returns the exact dimensions of the bounding box.
     * @param width The width of the bounding box
     * @param height The height of the bounding box
     * @param [mode=ResizeModes.BILINEAR] The resizing mode to use
     * @returns The resized image
     * @deprecated Pass {@link ResizeOptions} with `mode` instead, the positional mode will be removed in 4.0
     */
    cover(width: number, height: number, mode?: ResizeMode): this;
    /**
     * Crops an image to the specified dimensions.
     * The region is clipped to the image, so the result can be smaller than the requested size
     * @param x The x offset (0-based)
     * @param y The y offset (0-based)
     * @param width The new images width
     * @param height The new images height
     */
    crop(x: number, y: number, width: number, height: number): this;
    /**
     * Copies a region of the image into a new image, this one stays unchanged (like {@link Image.crop} on a clone,
     * without copying the whole image). The region is clipped to the image, so the result can be smaller than the
     * requested size
     * @param x The x offset (0-based)
     * @param y The y offset (0-based)
     * @param width The region's width
     * @param height The region's height
     */
    region(x: number, y: number, width: number, height: number): Image;
    /**
     * Removes borders of one color, e.g. the empty space around rendered text or around a logo on a solid background.
     * Frames keep their position: their offsets move by the trimmed amount. An image that only has the color stays
     * unchanged
     * @param options See {@link TrimOptions}
     */
    trim(options?: TrimOptions): this;
    /**
     * Removes borders of one color, e.g. the empty space around rendered text or around a logo on a solid background.
     * Frames keep their position: their offsets move by the trimmed amount. An image that only has the color stays
     * unchanged
     * @param color The border color, by default the color of the top left pixel. Fully transparent pixels count as the
     *     same color whatever their RGB values
     * @param options See {@link TrimOptions}
     * @deprecated Pass {@link TrimOptions} instead, the positional arguments will be removed in 4.0
     */
    trim(color?: Color, options?: TrimOptions): this;
    /**
     * Draws a box at the specified coordinates (0-based), clipped to the image
     * @param x The x offset
     * @param y The y offset
     * @param width The box width
     * @param height The box height
     * @param color The color to fill the box in with, a function gets coordinates relative to the box
     */
    drawBox(x: number, y: number, width: number, height: number, color: Color | ColorFunction): this;
    /**
     * Draws an antialiased circle around the center of the specified pixel (0-based)
     * @param x The center x position
     * @param y The center y position
     * @param radius The circles radius in pixels
     * @param color The color, a function gets coordinates relative to the circle's bounding box
     */
    drawCircle(x: number, y: number, radius: number, color: Color | ColorFunction): this;
    /**
     * Crops the image into a circle with an antialiased edge
     * @param options See {@link CropCircleOptions}
     */
    cropCircle(options?: CropCircleOptions): this;
    /**
     * Crops the image into a circle with an antialiased edge
     * @param max Whether to use the larger dimension for the size. Default: `false`
     * @param feathering Share of the radius (0..1) over which the edge fades out. Default: `0`
     * @deprecated Pass {@link CropCircleOptions} instead, `cropCircle({ fit: 'cover' })`. The arguments will be
     *     removed in 4.0
     */
    cropCircle(max?: boolean, feathering?: number): this;
    /**
     * Sets the RGB of every pixel to the given color, keeping each pixel's own alpha. Turns an image into a silhouette
     * or tints it: `image.recolor(0xffffffff)` makes every pixel white, keeping its transparency
     * @param color The color to use, its alpha is ignored
     */
    recolor(color: Color): this;
    /**
     * Sets the RGB of every pixel to the RGB of the same pixel of another image, keeping each pixel's own alpha. With a
     * gradient this fills a shape with it, e.g. gradient text:
     * `text.recolor(Image.linearGradient(text.width, text.height, { stops: [0x22d3eeff, 0xfb923cff], angle: 90 }))`
     * @param colors The image to take the colors from, it has to have the same size. Its alpha is ignored
     */
    recolor(colors: Image): this;
    /**
     * Scales the opacity of the image
     * @param opacity The factor to multiply the opacity with (0..1 lowers it, >1 raises it, results are clamped)
     * @param options See {@link AdjustOptions}
     */
    opacity(opacity: number, options?: AdjustOptions): this;
    /**
     * Scales the opacity of the image
     * @param opacity The factor to multiply the opacity with (0..1 lowers it, >1 raises it, results are clamped)
     * @param absolute Whether to set the opacity (true) instead of scaling it (false)
     * @deprecated Use {@link Image.opacity} to scale; for a fixed alpha, `absolute` is removed in 4.0
     */
    opacity(opacity: number, absolute?: boolean): this;
    /**
     * Scales the red channel
     * @param factor The factor to multiply the channel with (>= 0, results are clamped)
     * @param options See {@link AdjustOptions}
     */
    red(factor: number, options?: AdjustOptions): this;
    /**
     * Scales the red channel
     * @param factor The factor to multiply the channel with (>= 0, results are clamped)
     * @param absolute Whether to set every pixel's red channel to `factor` * 255 (true) instead of scaling it (false)
     * @deprecated Use {@link Image.recolor} to set a fixed color; `absolute` is removed in 4.0
     */
    red(factor: number, absolute?: boolean): this;
    /**
     * Scales the green channel
     * @param factor The factor to multiply the channel with (>= 0, results are clamped)
     * @param options See {@link AdjustOptions}
     */
    green(factor: number, options?: AdjustOptions): this;
    /**
     * Scales the green channel
     * @param factor The factor to multiply the channel with (>= 0, results are clamped)
     * @param absolute Whether to set every pixel's green channel to `factor` * 255 (true) instead of scaling it (false)
     * @deprecated Use {@link Image.recolor} to set a fixed color; `absolute` is removed in 4.0
     */
    green(factor: number, absolute?: boolean): this;
    /**
     * Scales the blue channel
     * @param factor The factor to multiply the channel with (>= 0, results are clamped)
     * @param options See {@link AdjustOptions}
     */
    blue(factor: number, options?: AdjustOptions): this;
    /**
     * Scales the blue channel
     * @param factor The factor to multiply the channel with (>= 0, results are clamped)
     * @param absolute Whether to set every pixel's blue channel to `factor` * 255 (true) instead of scaling it (false)
     * @deprecated Use {@link Image.recolor} to set a fixed color; `absolute` is removed in 4.0
     */
    blue(factor: number, absolute?: boolean): this;
    /**
     * Scales the lightness of the image (HSL), keeping its hue and saturation
     * @param value The factor to multiply the lightness with (>= 0, results are clamped)
     * @param options See {@link AdjustOptions}
     */
    lightness(value: number, options?: AdjustOptions): this;
    /**
     * Scales the lightness of the image (HSL), keeping its hue and saturation
     * @param value The factor to multiply the lightness with (>= 0, results are clamped)
     * @param absolute Whether to set the lightness (true) instead of scaling it (false)
     * @deprecated `absolute` is removed in 4.0: scale with a factor, or use {@link Image.recolor} for a fixed color
     */
    lightness(value: number, absolute?: boolean): this;
    /**
     * Scales the saturation of the image (HSL), keeping its hue and lightness. 0 makes it greyscale
     * @param value The factor to multiply the saturation with (>= 0, results are clamped)
     * @param options See {@link AdjustOptions}
     */
    saturation(value: number, options?: AdjustOptions): this;
    /**
     * Scales the saturation of the image (HSL), keeping its hue and lightness. 0 makes it greyscale
     * @param value The factor to multiply the saturation with (>= 0, results are clamped)
     * @param absolute Whether to set the saturation (true) instead of scaling it (false)
     * @deprecated `absolute` is removed in 4.0: scale with a factor, or use {@link Image.recolor} for a fixed color
     */
    saturation(value: number, absolute?: boolean): this;
    /**
     * Composites (overlays) the source onto this image
     * @param source The image to place
     * @param options Position, opacity and blend mode, see {@link CompositeOptions}
     */
    composite(source: Image, options?: CompositeOptions): this;
    /**
     * Composites (overlays) the source onto this image at the specified coordinates
     * @param source The image to place
     * @param [x=0] The x position to place the image at
     * @param [y=0] The y position to place the image at
     * @param options Opacity and blend mode, see {@link CompositeOptions}
     * @deprecated Pass {@link CompositeOptions} instead, the positional arguments will be removed in 4.0
     */
    composite(source: Image, x?: number, y?: number, options?: CompositeOptions): this;
    /**
     * Inverts the images colors
     */
    invert(): this;
    /**
     * Inverts the images lightness (HSL), keeping hue and saturation: dark colors become light and vice versa
     */
    invertLightness(): this;
    /**
     * Inverts the images value (HSV), keeping hue and saturation: the brightest channel `v` becomes `255 - v`
     * and the others scale along, black becomes white
     */
    invertValue(): this;
    /**
     * Shifts the images hue
     * @param degrees How many degrees to shift the hue by
     */
    hueShift(degrees: number): this;
    /**
     * Blurs the image with a gaussian blur (transparent pixels don't bleed their color)
     * @param radius The blur radius: the gaussian's standard deviation in pixels, like CSS' blur()
     */
    blur(radius: number): this;
    /**
     * Reduces the image to a palette of at most 256 colors (or a fixed one), in place, optionally dithered, e.g.
     * `image.quantize({ colors: 16, dither: 'floyd-steinberg' })` or `image.quantize({ palette: [0x0f380fff, 0x306230ff,
     * 0x8bac0fff, 0x9bbc0fff] })` for a Game Boy look. Transparent pixels (alpha 0) keep their color and don't count
     * towards the palette; the other pixels keep their alpha and only their RGB is reduced. The result is deterministic.
     * With a gain map (an HDR image), the HDR highlights are dropped, like {@link Image.invert} does: the map is neutral
     * afterwards. Frames quantize their own pixels
     * @param options See {@link QuantizeOptions}
     */
    quantize(options?: QuantizeOptions): this;
    /**
     * Mixes the colors of every pixel with a color matrix, like SVG's `feColorMatrix`: the new red, green, blue and alpha
     * are each a sum of the old red, green, blue and alpha times a factor, plus an offset. Greyscale, sepia, tints,
     * swapped channels, color blindness simulation or a mix of those in one pass.
     *
     * The values are 20 numbers, four rows of `[red, green, blue, alpha, offset]` for the new red, green, blue and alpha,
     * with the colors and the offsets as 0 to 1 (like CSS and SVG): `[1, 0, 0, 0, 0,  0, 1, 0, 0, 0,  0, 0, 1, 0, 0,
     * 0, 0, 0, 1, 0]` changes nothing, `[0, 0, 1, 0, 0,  0, 1, 0, 0, 0,  1, 0, 0, 0, 0,  0, 0, 0, 1, 0]` swaps red and
     * blue. Nine numbers are the first three rows without the alpha and the offsets (the alpha stays as it is). The
     * colors are the sRGB values, not premultiplied, and the results are clamped. With a gain map (an HDR image), the
     * HDR highlights follow the change as they do for other color changes
     * @param matrix The 9 or 20 values
     */
    colorMatrix(matrix: ArrayLike<number>): this;
    /**
     * Moves every point of the image with an affine transform, in one resampling: rotation, scaling, skew, flips and
     * shifts in any mix and around any point. The six numbers are SVG's `matrix(a b c d e f)`: a point (x, y) of the
     * image ends up at (a x + c y + e, b x + d y + f), with y pointing down.
     * ```ts
     * image.transform([1, 0, Math.tan(-0.3), 1, 0, 0]);             // slanted like italics, around the middle
     * image.transform([0.5, 0, 0, 0.5, 0, 0], { origin: { x: 0, y: 0 } }); // half the size
     * image.transform([-1, 0, 0, 1, 0, 0]);                         // flipped horizontally
     * const a = Math.PI / 6;
     * image.transform([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); // turned 30° clockwise
     * ```
     * The image grows to hold the result (`expand: false` keeps its size), so a shift only shows with `expand: false`.
     * The edges fade, like the pixels outside were transparent. A transform that flattens the image (a factor of 0) is
     * refused. With a gain map (an HDR image), the map moves with the image
     * @param matrix The six values [a, b, c, d, e, f]
     * @param options See {@link TransformOptions}
     */
    transform(matrix: ArrayLike<number>, options?: TransformOptions): this;
    /**
     * Adds a shadow behind the image, shaped by its alpha: a drop shadow with an offset, or a glow without one
     * (`image.dropShadow({ blur: 8, color: 0xff2fb9ff })`, with `spread` to make it stronger). The image grows to fit
     * the shadow, unless `expand` is `false`. Frames stay where they are (their offsets move with the growth), they only
     * grow up and left as far as their offset allows
     * @param options See {@link ShadowOptions}
     */
    dropShadow(options?: ShadowOptions): this;
    /**
     * Draws an outline around the image's shape (its alpha): the sticker effect for cut-out images, or an outline for
     * text. The image grows to fit it, unless `expand` is `false`. Frames stay where they are (their offsets move with
     * the growth), they only grow up and left as far as their offset allows
     * @param options See {@link OutlineOptions}
     */
    outline(options?: OutlineOptions): this;
    /**
     * Sharpens the image with an unsharp mask: the difference to a blurred copy is amplified
     * @param options See {@link SharpenOptions}
     */
    sharpen(options?: SharpenOptions): this;
    /**
     * Sharpens the image with an unsharp mask: the difference to a blurred copy is amplified
     * @param [amount=1] How strongly to sharpen (0 does nothing)
     * @param [radius=1] The radius of the blur the image is compared with (larger values sharpen coarser details)
     * @deprecated Pass {@link SharpenOptions} instead, the positional arguments will be removed in 4.0
     */
    sharpen(amount?: number, radius?: number): this;
    /**
     * Multiplies the color channels, e.g. 1.2 makes the image 20% brighter
     * @param factor The factor (>= 0, 1 keeps the image)
     */
    brightness(factor: number): this;
    /**
     * Scales the color channels' distance from mid grey, e.g. 1.5 increases the contrast, 0.5 reduces it
     * @param factor The factor (>= 0, 1 keeps the image, 0 makes it grey)
     */
    contrast(factor: number): this;
    /**
     * Applies a gamma correction, values above 1 brighten the dark tones, values below 1 darken them
     * @param gamma The gamma (> 0, 1 keeps the image)
     */
    gamma(gamma: number): this;
    /**
     * Converts the image to greyscale by its luma (ITU-R 601, like Pillow), keeping the alpha
     */
    greyscale(): this;
    /**
     * Applies a sepia tone
     */
    sepia(): this;
    /**
     * Makes a color transparent, like GIMP's "Color to Alpha": the color is removed from every pixel and replaced by
     * transparency, so pixels that are partly the color (e.g. antialiased edges against a background) become
     * semi-transparent instead of keeping a fringe of it.
     * The color is removed everywhere in the image, not only from a connected background: removing a white
     * background also makes white areas inside the subject (e.g. eyes in a logo) transparent
     * @param options See {@link ColorToAlphaOptions}
     */
    colorToAlpha(options?: ColorToAlphaOptions): this;
    /**
     * Makes a color transparent, like GIMP's "Color to Alpha": the color is removed from every pixel and replaced by
     * transparency, so pixels that are partly the color (e.g. antialiased edges against a background) become
     * semi-transparent instead of keeping a fringe of it.
     * The color is removed everywhere in the image, not only from a connected background: removing a white
     * background also makes white areas inside the subject (e.g. eyes in a logo) transparent
     * @param color The color to remove, by default the color of the top left pixel (e.g. a background)
     * @param options See {@link ColorToAlphaOptions}
     * @deprecated Pass {@link ColorToAlphaOptions} instead, the positional arguments will be removed in 4.0
     */
    colorToAlpha(color?: Color, options?: ColorToAlphaOptions): this;
    /**
     * Gets the average color of the image, weighting each pixel by its opacity
     * @returns The average color (fully opaque), black for fully transparent images
     */
    averageColor(): Color;
    /**
     * Gets the image's dominant color: the colors are grouped into a few clusters (median cut and k-means),
     * the average color of the largest one is returned
     * @param options Which colors to ignore, see {@link DominantColorOptions}
     * @return The image's dominant color (fully opaque); mostly transparent pixels are ignored.
     *     If every pixel is ignored as black or white, the filter is dropped
     */
    dominantColor(options?: DominantColorOptions): Color;
    /**
     * Gets the image's dominant color, see {@link Image.dominantColor | the variant with options}
     * @param ignoreBlack Whether to ignore dark colors (all channels below the threshold). Default: `true`
     * @param ignoreWhite Whether to ignore light colors (all channels above 255 minus the threshold). Default: `true`
     * @param bwThreshold The black/white threshold (0-64, in steps of 4 channel values). Default: `15`
     * @return The image's dominant color (fully opaque)
     * @deprecated Pass {@link DominantColorOptions} instead, the positional arguments will be removed in 4.0
     */
    dominantColor(ignoreBlack?: boolean, ignoreWhite?: boolean, bwThreshold?: number): Color;
    /**
     * Rotates the image counterclockwise by the given amount of degrees
     * @param angle The angle to rotate the image for (in degrees)
     * @param options See {@link RotateOptions}
     */
    rotate(angle: number, options?: RotateOptions): this;
    /**
     * Rotates the image counterclockwise by the given amount of degrees
     * @param angle The angle to rotate the image for (in degrees)
     * @param resize Whether to resize the image so it fits all pixels or just ignore outlying pixels. Default: `true`
     * @deprecated Pass {@link RotateOptions} instead, the positional arguments will be removed in 4.0
     */
    rotate(angle: number, resize?: boolean): this;
    /**
     * Flips / mirrors the image horizontally or vertically
     * @param direction The direction to flip
     */
    flip(direction: 'horizontal' | 'vertical'): this;
    /**
     * Rounds the images corners, with antialiased edges
     * @param options See {@link RoundCornersOptions}
     */
    roundCorners(options?: RoundCornersOptions): this;
    /**
     * Rounds the images corners, with antialiased edges
     * @param [radius=min(width,height)/4] The radius of the corners
     * @deprecated Pass {@link RoundCornersOptions} instead, the positional arguments will be removed in 4.0
     */
    roundCorners(radius?: number): this;
    /**
     * Applies a fisheye (barrel distortion) effect
     * @param options See {@link FisheyeOptions}
     */
    fisheye(options?: FisheyeOptions): this;
    /**
     * Applies a fisheye (barrel distortion) effect
     * @param [strength=2] The distortion strength (exponent of the radial mapping), higher values bulge the center more
     * @deprecated Pass {@link FisheyeOptions} instead, the positional arguments will be removed in 4.0
     */
    fisheye(strength?: number): this;
    /**
     * Encodes the image into a PNG, with the smallest lossless color type (a palette for up to 256 colors,
     * greyscale or RGB, alpha only if needed). Uses the runtime's native zlib when available
     * @param options See {@link PNGEncodeOptions}
     * @return The encoded data
     */
    encodePNG(options?: PNGEncodeOptions): Promise<Uint8Array>;
    /**
     * Encodes the image into a PNG
     * @param compression The compression level (0-9). Default: `4`
     * @param metadata Metadata to include, see {@link Metadata}
     * @return The encoded data
     * @deprecated Pass {@link PNGEncodeOptions} instead, the positional arguments will be removed in 4.0
     */
    encodePNG(compression?: number, metadata?: Metadata): Promise<Uint8Array>;
    /**
     * Encodes the image into a PNG with compression level 4
     * @param metadata Metadata to include, see {@link Metadata}
     * @return The encoded data
     * @deprecated Pass {@link PNGEncodeOptions} instead, the positional arguments will be removed in 4.0
     */
    encodePNG(metadata?: Metadata): Promise<Uint8Array>;
    /**
     * Encodes the image into a PNG
     * @param options See {@link PNGEncodeOptions}
     * @return The encoded data
     * @deprecated Use {@link Image.encodePNG}, `encode()` will be removed in 4.0
     * @group Deprecated
     */
    encode(options?: PNGEncodeOptions): Promise<Uint8Array>;
    /**
     * Encodes the image into a PNG
     * @param compression The compression level (0-9). Default: `4`
     * @param metadata Metadata to include, see {@link Metadata}
     * @return The encoded data
     * @deprecated Use {@link Image.encodePNG}, `encode()` will be removed in 4.0
     * @group Deprecated
     */
    encode(compression?: number, metadata?: Metadata): Promise<Uint8Array>;
    /**
     * Encodes the image into a PNG with compression level 4
     * @param metadata Metadata to include, see {@link Metadata}
     * @return The encoded data
     * @deprecated Use {@link Image.encodePNG}, `encode()` will be removed in 4.0
     * @group Deprecated
     */
    encode(metadata?: Metadata): Promise<Uint8Array>;
    /**
     * Encodes the image into a JPEG
     * @param options See {@link JPEGEncodeOptions}
     */
    encodeJPEG(options?: JPEGEncodeOptions): Promise<Uint8Array>;
    /**
     * Encodes the image into a JPEG
     * @param [quality=90] The JPEG quality to use (1-100), chroma subsampling is disabled above 90
     * @deprecated Pass {@link JPEGEncodeOptions} instead, the positional arguments will be removed in 4.0
     */
    encodeJPEG(quality?: number): Promise<Uint8Array>;
    /**
     * Encodes the image as WebP: lossless (usually 20-30% smaller than PNG, but slower to encode), or lossy with a
     * quality
     * @param options See {@link WebPEncodeOptions}
     */
    encodeWebP({ quality, effort, sharpYuv, alphaQuality, threads, metadata }?: WebPEncodeOptions): Promise<Uint8Array>;
    /**
     * Encodes the image as run length encoded TGA (32 bit, or 24 bit if the image is opaque)
     * @param options See {@link EncodeOptions}
     */
    encodeTGA({ metadata }?: EncodeOptions): Promise<Uint8Array>;
    /**
     * Encodes the image as BMP: with a palette if it is opaque and has at most 256 colors, else with 24 bit pixels, or
     * 32 bit ones if it has transparency
     */
    encodeBMP(): Promise<Uint8Array>;
    /**
     * Encodes the image as QOI (3 channels if the image is opaque)
     */
    encodeQOI(): Promise<Uint8Array>;
    /**
     * Encodes the image as AVIF (AV1, with an alpha image if the image has transparency)
     * @param options See {@link AVIFEncodeOptions}
     */
    encodeAVIF({ quality, alphaQuality, subsampling, effort, threads, metadata, gainMap }?: AVIFEncodeOptions): Promise<Uint8Array>;
    /**
     * Encodes the image as JPEG XL: losslessly (the default) like libjxl's `cjxl -e 3` (a palette of up to 1024 colors,
     * else palettes of channels using few of their values; YCoCg; the weighted predictor in contexts of its error;
     * greyscale if the image is), at effort 0 the codestream byte for byte like `cjxl -e 1` on CPUs with AVX2 or NEON
     * (its fast lossless mode: the gradient predictor, a palette if the image has at most 511 colors besides black,
     * else YCoCg), or lossy with a quality (like `cjxl -q`: XYB, varblocks of libjxl's search, chroma from luma, the
     * edge preserving filter). Alpha (if the image has transparency) is lossless either way. The codestream is in the
     * container, with the metadata as Exif
     * @param options See {@link JXLEncodeOptions}
     */
    encodeJXL({ quality, effort, threads, metadata, gainMap }?: JXLEncodeOptions): Promise<Uint8Array>;
    /**
     * Encodes the image as the smallest fitting Netpbm format: PBM for black and white images, PGM for greyscale ones,
     * PPM for others, PAM if the image has transparency
     */
    encodePNM(): Promise<Uint8Array>;
    /**
     * Decodes an image (PNG, JPEG, TIFF, WebP, BMP, ICO, CUR, QOI, PBM, PGM, PPM, PAM, PFM, Radiance HDR, TGA, AVIF or
     * JPEG XL). For APNGs this is the default image; animated WebPs and GIFs have no single image, decode those with
     * {@link Animation.decode}; for icons and cursors it's their largest image, for AVIF image sequences and JPEG XL
     * animations their first frame
     * @param input The binary data to decode
     * @param options See {@link DecodeOptions}. JPEGs, TIFFs and PNGs are rotated/mirrored as their orientation tag
     *     (Exif, for PNGs also XMP) says by default: photos taken with a rotated camera are stored sideways
     * @return The decoded image
     */
    static decode(input: BinaryData, options?: DecodeOptions): Promise<Image>;
    /**
     * @deprecated Use `renderSVG(svg, { scale })`: `Image.SVG_MODE_*` and `SVGScaleModes` are removed in 4.0
     * @group Deprecated
     */
    static readonly SVG_MODE_SCALE = 1;
    /**
     * @deprecated Use `renderSVG(svg, { width })`: `Image.SVG_MODE_*` and `SVGScaleModes` are removed in 4.0
     * @group Deprecated
     */
    static readonly SVG_MODE_WIDTH = 2;
    /**
     * @deprecated Use `renderSVG(svg, { height })`: `Image.SVG_MODE_*` and `SVGScaleModes` are removed in 4.0
     * @group Deprecated
     */
    static readonly SVG_MODE_HEIGHT = 3;
    /**
     * Creates a new image from the given SVG
     * Supports shapes, paths, transforms, use/symbol, CSS styles, gradients, patterns, strokes, markers, clip paths,
     * masks, opacity, blend modes, filters (all primitives and the filter functions) and images embedded as data URIs
     * (PNG, JPEG, GIF, WebP, SVG) or given with {@link SVGOptions.images}, and text with the given or embedded fonts
     * (see {@link SVGOptions.fonts}). Hrefs are resolved from the options and the data URIs only, never from files or URLs.
     * @example
     * ```ts
     * const logo = await Image.renderSVG(
     *     '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image href="logo.png" width="64" height="64"/></svg>',
     *     { images: { 'logo.png': logoPNG } } // (the PNG's bytes, e.g. from a fetch or a file you read)
     * );
     * ```
     * @param svg The SVG content
     * @param options See {@link SVGOptions}
     * @return The rendered SVG graphic
     */
    static renderSVG(svg: string | BinaryData, options?: SVGOptions): Promise<Image>;
    /**
     * Creates a new image from the given SVG
     * @param svg The SVG content
     * @param size The size to use
     * @param mode The SVG resizing mode to use (one of {@link SVGScaleModes.SCALE}, {@link SVGScaleModes.WIDTH}, {@link SVGScaleModes.HEIGHT})
     * @return The rendered SVG graphic
     * @deprecated Pass {@link SVGOptions} instead, `renderSVG(svg, { width: 512 })` (or `height`, `scale`). The
     *     positional arguments will be removed in 4.0
     */
    static renderSVG(svg: string | BinaryData, size?: number, mode?: SVGScaleMode): Promise<Image>;
    /**
     * Creates a new image containing the rendered text.
     * @param text Text to render
     * @param options The font and size, color, layout and style, see {@link RenderTextOptions}; the image grows by the
     *     outline width on every side
     * @return The rendered text
     */
    static renderText(text: string, options: RenderTextOptions): Promise<Image>;
    /**
     * Creates a new image containing the rendered text.
     * @param font TrueType (ttf/ttc), OpenType (otf) or WOFF font buffer to use, or several by priority: every
     *     character comes from the first font that has it (e.g. `[text, emoji]`), the first one sets the line height.
     *     Color glyphs (COLR layers and paints, CBDT and sbix bitmaps, as in emoji fonts) keep their colors. Text in any
     *     script is shaped like browsers do (right to left and bidirectional text, Arabic joining, Indic conjuncts,
     *     marks)
     * @param size Font size in pixels (per em)
     * @param text Text to render
     * @param options Color, layout and style, see {@link TextOptions}; the image grows by the outline width on every
     *     side
     * @return The rendered text
     * @deprecated Pass the text first and everything else as options, `Image.renderText(text, { font, size })`.
     *     This signature will be removed in 4.0
     */
    static renderText(font: BinaryData | BinaryData[], size: number, text: string, options?: TextOptions): Promise<Image>;
    /**
     * Creates a new image containing the rendered text.
     * @param font TrueType (ttf/ttc), OpenType (otf) or WOFF font buffer to use, or several by priority: every
     *     character comes from the first font that has it (e.g. `[text, emoji]`), the first one sets the line height.
     *     Color glyphs (COLR layers and paints, CBDT and sbix bitmaps, as in emoji fonts) keep their colors. Text in any
     *     script is shaped like browsers do (right to left and bidirectional text, Arabic joining, Indic conjuncts,
     *     marks)
     * @param size Font size in pixels (per em)
     * @param text Text to render
     * @param [color=0xffffffff] Text color to use
     * @param [layout] The text layout to use
     * @param style Outline, see {@link TextStyle}; the image grows by the outline width on every side
     * @return The rendered text
     * @deprecated Pass the text first and everything else as options, `Image.renderText(text, { font, size })`.
     *     This signature will be removed in 4.0
     */
    static renderText(font: BinaryData | BinaryData[], size: number, text: string, color?: Color, layout?: TextLayout, style?: TextStyle): Promise<Image>;
}
