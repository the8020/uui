const HORIZONTAL = ['left', 'center', 'right'];
const VERTICAL = ['top', 'middle', 'bottom'];
export class TextLayout {
    maxWidth;
    maxHeight;
    wrapStyle;
    horizontalAlign = 'left';
    verticalAlign = 'top';
    wrapHardBreaks;
    constructor(options = {}) {
        const { maxWidth, maxHeight, wrapStyle, verticalAlign, horizontalAlign, wrapHardBreaks } = options;
        this.maxWidth = maxWidth === undefined || maxWidth === 0 ? Infinity : Number(maxWidth);
        if (isNaN(this.maxWidth) || this.maxWidth < 1)
            throw new RangeError('Invalid maxWidth');
        this.maxHeight = maxHeight === undefined || maxHeight === 0 ? Infinity : Number(maxHeight);
        if (isNaN(this.maxHeight) || this.maxHeight < 1)
            throw new RangeError('Invalid maxHeight');
        this.wrapStyle = wrapStyle || 'word';
        if (!['word', 'char'].includes(this.wrapStyle))
            throw new RangeError('Invalid wrapStyle');
        for (const value of [horizontalAlign, verticalAlign]) {
            if (value === undefined)
                continue;
            if (HORIZONTAL.includes(value))
                this.horizontalAlign = value;
            else if (VERTICAL.includes(value))
                this.verticalAlign = value;
            else
                throw new RangeError(`Invalid alignment: ${value}`);
        }
        this.wrapHardBreaks = typeof wrapHardBreaks === 'undefined' ? true : wrapHardBreaks;
        if (typeof this.wrapHardBreaks !== 'boolean')
            throw new TypeError('Invalid wrapHardBreaks');
    }
}
