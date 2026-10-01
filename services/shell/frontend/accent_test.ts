import { assert, assertEquals, assertThrows } from "@std/assert";
import { accentTokens, applyAccent } from "./accent.ts";

Deno.test("custom accents keep readable text and controls in both themes and reset to purple", () => {
  const luminance = (rgb: number[]) =>
    rgb.map((v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }).reduce((total, v, i) => total + v * [0.2126, 0.7152, 0.0722][i]!, 0);
  const contrast = (a: number[], b: number[]) => {
    const values = [luminance(a), luminance(b)].sort((a, b) => a - b);
    return (values[1]! + 0.05) / (values[0]! + 0.05);
  };
  for (const dark of [false, true]) {
    for (
      const color of [
        "#000000",
        "#ffffff",
        "#ff8800",
        "#16803e",
        "#ff0000",
        "#ffff00",
      ]
    ) {
      const tokens = accentTokens(color, dark);
      const primary = tokens["--primary"]!.match(/\d+/g)!.map(Number);
      assert(contrast(primary, dark ? [25, 29, 42] : [255, 255, 255]) >= 4.5);
      assert(
        contrast(
          primary,
          tokens["--primary-foreground"] === "#ffffff"
            ? [255, 255, 255]
            : [0, 0, 0],
        ) >= 4.5,
      );
    }
  }
  assertThrows(() => accentTokens("red", false), TypeError);
  const properties = new Map<string, string>();
  const root = {
    dataset: { theme: "dark" },
    style: {
      setProperty: (key: string, value: string) => properties.set(key, value),
      removeProperty: (key: string) => properties.delete(key),
    },
  } as unknown as HTMLElement;
  applyAccent(root, "#ff8800");
  assertEquals(properties.size, 4);
  applyAccent(root, "#5B5BD6");
  assertEquals(properties.size, 0);
});
