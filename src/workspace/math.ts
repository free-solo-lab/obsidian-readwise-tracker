/**
 * Models write formulas as `\[ … \]` and `\( … \)`. Obsidian renders only `$$ … $$` and `$ … $`,
 * and Markdown would otherwise eat the backslashes, leaving bare brackets and broken TeX.
 * Code (fenced or inline) is left untouched.
 */
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/;
const DISPLAY = /\\\[([\s\S]+?)\\\]/g;
const INLINE = /\\\(([^\n]+?)\\\)/g;

/**
 * Another backslash right before the delimiter means a TeX line break such as `\\[2pt]`, not math.
 * Checked by hand because regex lookbehind is not available on older iOS.
 */
const isLineBreak = (text: string, offset: number): boolean => text[offset - 1] === "\\";

export function latexToObsidianMath(text: string): string {
  if (!text.includes("\\[") && !text.includes("\\(")) return text;
  return text
    .split(CODE)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .replace(DISPLAY, (match, math: string, offset: number) =>
          isLineBreak(part, offset) ? match : `\n$$\n${math.trim()}\n$$\n`,
        )
        .replace(INLINE, (match, math: string, offset: number) =>
          isLineBreak(part, offset) ? match : `$${math.trim()}$`,
        );
    })
    .join("");
}
