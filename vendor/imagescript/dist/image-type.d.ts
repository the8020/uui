import { BinaryData } from './util/mem.d.ts';
/** Image formats recognized by {@link ImageType.getType} */
export type ImageTypeName = 'png' | 'jpeg' | 'tiff' | 'gif' | 'webp' | 'avif' | 'jxl' | 'bmp' | 'ico' | 'cur' | 'qoi' | 'pnm' | 'hdr' | 'tga';
/** Detects image formats by their magic numbers */
export declare class ImageType {
    private constructor();
    /**
     * Gets an image's type from its magic number
     * @param data The image binary to get the type of
     * @returns The image type, or null if it isn't supported
     */
    static getType(data: BinaryData): ImageTypeName | null;
    /**
     * Whether the data starts like a PNG
     * @param data The file's data
     */
    static isPNG(data: BinaryData): boolean;
    /**
     * Whether the data starts like a JPEG
     * @param data The file's data
     */
    static isJPEG(data: BinaryData): boolean;
    /**
     * Whether the data starts like a TIFF (or BigTIFF)
     * @param data The file's data
     */
    static isTIFF(data: BinaryData): boolean;
    /**
     * Whether the data starts like a GIF
     * @param data The file's data
     */
    static isGIF(data: BinaryData): boolean;
    /**
     * Whether the data starts like a WebP
     * @param data The file's data
     */
    static isWebP(data: BinaryData): boolean;
    /**
     * Whether the data starts like an AVIF (the avif or avis brand)
     * @param data The file's data
     */
    static isAVIF(data: BinaryData): boolean;
    /**
     * Whether the data starts like a JPEG XL (a codestream or the container)
     * @param data The file's data
     */
    static isJXL(data: BinaryData): boolean;
    /**
     * Whether the data starts like a BMP
     * @param data The file's data
     */
    static isBMP(data: BinaryData): boolean;
    /**
     * Whether the data is a Windows icon or cursor (ICO or CUR)
     * @param data The file's data
     */
    static isICO(data: BinaryData): boolean;
    /**
     * Whether the data starts like a QOI
     * @param data The file's data
     */
    static isQOI(data: BinaryData): boolean;
    /**
     * Whether the data starts like a Netpbm image (PBM, PGM, PPM, PAM or PFM)
     * @param data The file's data
     */
    static isPNM(data: BinaryData): boolean;
    /**
     * Whether the data starts like a Radiance HDR
     * @param data The file's data
     */
    static isHDR(data: BinaryData): boolean;
    /**
     * Whether the data looks like a TGA (which has no magic number: its header has to be consistent)
     * @param data The file's data
     */
    static isTGA(data: BinaryData): boolean;
}
