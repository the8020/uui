import { BinaryData } from './util/mem.d.ts';
import { Image, DecodeOptions } from './image.d.ts';
import { GIF } from './gif.d.ts';
import { Animation, AnimationDecodeOptions } from './animation.d.ts';
export { Image, ResizeModes, SVGScaleModes } from './image.d.ts';
export { Colors } from './colors.d.ts';
export type { Color, ColorFunction, ResizeMode, SVGScaleMode, PNGMetadata, TextStyle, DecodeOptions, CompositeOptions, BlendMode, CropCircleOptions, DominantColorOptions, RotateOptions, ColorToAlphaOptions, ResizeOptions, ResizeToOptions, AdjustOptions, SharpenOptions, PNGEncodeOptions, JPEGEncodeOptions, WebPEncodeOptions, AVIFEncodeOptions, JXLEncodeOptions, EncodeOptions, SVGOptions, RenderSVGOptions, TextOptions, RenderTextOptions, ShadowOptions, OutlineOptions, QuantizeOptions, TransformOptions, TransformMode, GradientOptions, LinearGradientOptions, RadialGradientOptions, RoundCornersOptions, FisheyeOptions, TrimOptions } from './image.d.ts';
export { Frame, FrameDisposalModes } from './frame.d.ts';
export type { FrameDisposalMode, FrameDisposalModeName, FrameDisposalModeId, FrameOptions } from './frame.d.ts';
export { GainMap } from './gainmap.d.ts';
export type { GainMapOptions, GainMapEncodeOptions } from './gainmap.d.ts';
export { GIF } from './gif.d.ts';
export { Animation } from './animation.d.ts';
export type { AnimationOptions, AnimationDecodeOptions, AnimationEncodeOptions, WebPAnimationEncodeOptions, GIFEncodeOptions, APNGEncodeOptions } from './animation.d.ts';
export { AnimationEncoder } from './animation-encoder.d.ts';
export type { AnimationEncoderOptions, WebPAnimationEncoderOptions, GIFAnimationEncoderOptions, APNGAnimationEncoderOptions } from './animation-encoder.d.ts';
export { TextLayout } from './text-layout.d.ts';
export type { TextLayoutOptions, WrapStyle, HorizontalAlign, VerticalAlign } from './text-layout.d.ts';
export { ImageType } from './image-type.d.ts';
export type { ImageTypeName } from './image-type.d.ts';
export type { ToneMapping } from './codecs/hdr.d.ts';
export type { BinaryData } from './util/mem.d.ts';
export type { Metadata } from './metadata.d.ts';
/**
 * Decodes any supported image: GIFs are returned as {@link GIF} (an {@link Animation}), animated WebPs as
 * {@link Animation}, everything else (including APNGs, as their default image) as {@link Image}.
 * {@link Animation.decode} decodes the frames of GIFs, APNGs and WebPs
 * @param data The image data
 * @param options See {@link AnimationDecodeOptions} (for animations) and {@link DecodeOptions} (for images)
 */
export declare function decode(data: BinaryData, options?: AnimationDecodeOptions & DecodeOptions): Promise<GIF | Animation | Image>;
/**
 * Decodes any supported image: GIFs are returned as {@link GIF} (an {@link Animation}), animated WebPs as
 * {@link Animation}, everything else (including APNGs, as their default image) as {@link Image}.
 * {@link Animation.decode} decodes the frames of GIFs, APNGs and WebPs
 * @param data The image data
 * @param onlyExtractFirstFrame Whether to end animation decoding after the first frame
 */
export declare function decode(data: BinaryData, onlyExtractFirstFrame?: boolean): Promise<GIF | Animation | Image>;
