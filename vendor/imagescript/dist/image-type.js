import { view as bytes } from "./util/mem.js";
import { isTGA } from "./codecs/tga.js";
import { isBMP } from "./codecs/bmp.js";
import { iconType } from "./codecs/ico.js";
import { isQOI } from "./codecs/qoi.js";
import { isNetpbm } from "./codecs/netpbm.js";
import { isHDR } from "./codecs/hdr.js";
import { isAVIF } from "./codecs/avif.js";
import { isJXL } from "./codecs/jxl.js";
const MAGIC_NUMBERS = {
    PNG: 0x89504e47,
    JPEG: 0xffd8ff,
    TIFF_LE: 0x49492a00,
    TIFF_BE: 0x4d4d002a,
    BIGTIFF_LE: 0x49492b00,
    BIGTIFF_BE: 0x4d4d002b,
    GIF: 0x474946,
    RIFF: 0x52494646,
    WEBP: 0x57454250
};
function dataView(data) {
    if (data instanceof DataView)
        return data;
    const u8 = bytes(data);
    return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
}
const u8 = (view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
export class ImageType {
    constructor() { }
    static getType(data) {
        const view = dataView(data);
        if (this.isPNG(view))
            return 'png';
        if (this.isJPEG(view))
            return 'jpeg';
        if (this.isTIFF(view))
            return 'tiff';
        if (this.isGIF(view))
            return 'gif';
        if (this.isWebP(view))
            return 'webp';
        if (this.isAVIF(view))
            return 'avif';
        if (this.isJXL(view))
            return 'jxl';
        if (this.isBMP(view))
            return 'bmp';
        const icon = iconType(u8(view));
        if (icon)
            return icon;
        if (this.isQOI(view))
            return 'qoi';
        if (this.isPNM(view))
            return 'pnm';
        if (this.isHDR(view))
            return 'hdr';
        if (this.isTGA(view))
            return 'tga';
        return null;
    }
    static isPNG(data) {
        const view = dataView(data);
        return view.byteLength >= 4 && view.getUint32(0, false) === MAGIC_NUMBERS.PNG;
    }
    static isJPEG(data) {
        const view = dataView(data);
        return view.byteLength >= 4 && (view.getUint32(0, false) >>> 8) === MAGIC_NUMBERS.JPEG;
    }
    static isTIFF(data) {
        const view = dataView(data);
        if (view.byteLength < 4)
            return false;
        const magic = view.getUint32(0, false);
        return magic === MAGIC_NUMBERS.TIFF_LE || magic === MAGIC_NUMBERS.TIFF_BE || magic === MAGIC_NUMBERS.BIGTIFF_LE || magic === MAGIC_NUMBERS.BIGTIFF_BE;
    }
    static isGIF(data) {
        const view = dataView(data);
        return view.byteLength >= 4 && (view.getUint32(0, false) >>> 8) === MAGIC_NUMBERS.GIF;
    }
    static isWebP(data) {
        const view = dataView(data);
        return view.byteLength >= 12 && view.getUint32(0, false) === MAGIC_NUMBERS.RIFF && view.getUint32(8, false) === MAGIC_NUMBERS.WEBP;
    }
    static isAVIF(data) {
        return isAVIF(u8(dataView(data)));
    }
    static isJXL(data) {
        return isJXL(u8(dataView(data)));
    }
    static isBMP(data) {
        return isBMP(u8(dataView(data)));
    }
    static isICO(data) {
        return iconType(u8(dataView(data))) !== null;
    }
    static isQOI(data) {
        return isQOI(u8(dataView(data)));
    }
    static isPNM(data) {
        return isNetpbm(u8(dataView(data)));
    }
    static isHDR(data) {
        return isHDR(u8(dataView(data)));
    }
    static isTGA(data) {
        return isTGA(u8(dataView(data)));
    }
}
