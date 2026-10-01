type RGB = [number, number, number];

function luminance(color: RGB): number {
  const linear = color.map((value) => {
    value /= 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrast(a: RGB, b: RGB): number {
  const values = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (values[1]! + 0.05) / (values[0]! + 0.05);
}

/** Keep the chosen hue readable on the theme's card surface. */
export function accentTokens(
  color: string,
  dark: boolean,
): Record<string, string> {
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw new TypeError("Invalid accent color");
  }
  const chosen = [1, 3, 5].map((offset) =>
    parseInt(color.slice(offset, offset + 2), 16)
  ) as RGB;
  const surface: RGB = dark ? [25, 29, 42] : [255, 255, 255];
  const target = dark ? 255 : 0;
  let primary = chosen;
  for (let step = 1; contrast(primary, surface) < 4.5 && step <= 100; step++) {
    primary = chosen.map((value) =>
      Math.round(value + (target - value) * step / 100)
    ) as RGB;
  }
  const foreground = luminance(primary) > 0.179 ? "#000000" : "#ffffff";
  const rgb = `rgb(${primary.join(" ")})`;
  return {
    "--primary": rgb,
    "--primary-dark": `color-mix(in srgb, ${rgb}, ${
      foreground === "#ffffff" ? "#000000" : "#ffffff"
    } 8%)`,
    "--primary-soft": `color-mix(in srgb, ${rgb} 15%, var(--surface))`,
    "--primary-foreground": foreground,
  };
}

export function applyAccent(
  root: HTMLElement,
  color: string | undefined,
): void {
  for (
    const name of [
      "--primary",
      "--primary-dark",
      "--primary-soft",
      "--primary-foreground",
    ]
  ) {
    root.style.removeProperty(name);
  }
  if (color === undefined || color.toLowerCase() === "#5b5bd6") return;
  for (
    const [name, value] of Object.entries(
      accentTokens(color, root.dataset.theme === "dark"),
    )
  ) {
    root.style.setProperty(name, value);
  }
}
