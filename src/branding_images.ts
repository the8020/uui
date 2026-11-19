export const MAX_IMAGE_UPLOAD = 10 * 1024 * 1024;

export const brandingImage = {
  logo: {
    width: 384,
    height: 128,
    minimumRatio: 1,
    maximumRatio: 3,
    type: "image/png",
    file: "logo.png",
    maximumBytes: 262_144,
  },
  favicon: {
    width: 64,
    height: 64,
    type: "image/png",
    file: "favicon.png",
    maximumBytes: 32_768,
  },
  social: {
    width: 1200,
    height: 630,
    type: "image/jpeg",
    file: "social.jpg",
    maximumBytes: 1_048_576,
  },
} as const;
export type BrandingImage = keyof typeof brandingImage;
