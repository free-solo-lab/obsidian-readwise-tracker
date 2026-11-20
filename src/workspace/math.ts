/**
 * Models write formulas as `\[ … \]` and `\( … \)`. Obsidian renders only `$$ … $$` and `$ … $`,
 * and Markdown would otherwise eat the backslashes, leaving bare brackets and broken TeX.
 * Code (fenced or inline) is left untouched.
 */
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/;
const DISPLAY = /(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/g;
const INLINE = /(?<!\\)\\\(([^\n]+?)(?<!\\)\\\)/g;

export function latexToObsidianMath(text: string): string {
  if (!text.includes("\\[") && !text.includes("\\(")) return text;
  return text
    .split(CODE)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .replace(DISPLAY, (_match, math: string) => `\n$$\n${math.trim()}\n$$\n`)
        .replace(INLINE, (_match, math: string) => `$${math.trim()}$`);
    })
    .join("");
}
