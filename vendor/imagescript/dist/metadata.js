import { VERSION } from "./version.js";
import { encode as utf8 } from "./util/utf8.js";
import * as exif from "./codecs/exif.js";
const TEXT_FIELDS = ['title', 'author', 'description', 'copyright', 'software', 'disclaimer', 'warning', 'source', 'comment'];
export function resolveMetadata(metadata = {}) {
    const { creationTime, software } = metadata || {};
    const time = new Date(creationTime === undefined ? Date.now() : creationTime);
    if (isNaN(time.getTime()))
        throw new RangeError('Invalid creation time');
    const resolved = { creationTime: time };
    for (const key of TEXT_FIELDS) {
        const value = key === 'software' && software === undefined ? `ImageScript v${VERSION}` : metadata?.[key];
        if (value)
            resolved[key] = String(value);
    }
    return resolved;
}
export function pngText(m) {
    return {
        Title: m.title,
        Author: m.author,
        Description: m.description,
        Copyright: m.copyright,
        'Creation Time': m.creationTime.toUTCString(),
        Software: m.software,
        Disclaimer: m.disclaimer,
        Warning: m.warning,
        Source: m.source,
        Comment: m.comment
    };
}
export function exifData(m) {
    return exif.encode({
        description: m.description,
        software: m.software,
        dateTime: m.creationTime,
        artist: m.author,
        copyright: m.copyright
    });
}
export function gifComments(m) {
    return [m.software, m.comment].filter((c) => !!c).map(utf8);
}
