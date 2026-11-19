/**
 * Metadata written by the encoders. Each format stores the fields it has a place for:
 *
 * | Format | Fields |
 * |---|---|
 * | PNG, APNG | all (as text chunks) |
 * | JPEG | author, description, copyright, creation time, software (Exif); comment (comment marker) |
 * | WebP, AVIF, JPEG XL | author, description, copyright, creation time, software (Exif) |
 * | GIF | software, comment (comment extensions) |
 * | TGA | author, comment, creation time, software (extension area) |
 *
 * Empty fields are left out
 */
export interface Metadata {
    /** The image's title */
    title?: string;
    /** The image's author */
    author?: string;
    /** The image's description */
    description?: string;
    /** The image's copyright info */
    copyright?: string;
    /** The image's creation time. Default: now */
    creationTime?: string | number | Date;
    /** The software used to create the image. Default: `'ImageScript vX.X.X'`, `''` leaves it out */
    software?: string;
    /** A disclaimer for the image */
    disclaimer?: string;
    /** A warning for the image */
    warning?: string;
    /** The image's source */
    source?: string;
    /** A comment for the image */
    comment?: string;
}
