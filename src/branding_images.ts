export const brandingImage = {
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
