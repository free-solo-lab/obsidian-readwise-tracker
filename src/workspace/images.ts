export interface ImageReference {
  resource: string;
  start: number;
  end: number;
}

/** Keep source offsets; image names/alt text alone never establish identity. */
export function imageReferences(markdown: string): ImageReference[] {
  const masked = markdown.replace(
    /<!--[^]*?-->|^\s*(`{3,}|~{3,})[^\n]*\n[^]*?^\s*\1\s*$|`[^`\n]*`/gm,
    (match) => " ".repeat(match.length),
  );
  const result: ImageReference[] = [];
  const pattern =
    /!\[[^\]\n]*\]\(\s*(<[^>\n]+>|(?:[^\s()\\]|\\.|\([^()]*\))+)\s*(?:["'][^\n]*?["']\s*)?\)|!\[\[([^\]\n]+)\]\]|<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of masked.matchAll(pattern)) {
    let resource = match[1] || match[2]?.split("|")[0] || match[3];
    if (
      match[2] &&
      !/\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:#.*)?$/i.test(resource)
    )
      continue;
    resource = resource
      .replace(/^<|>$/g, "")
      .replace(/\\([() ])/g, "$1")
      .replace(/&amp;/g, "&");
    result.push({
      resource,
      start: match.index || 0,
      end: (match.index || 0) + match[0].length,
    });
  }
  return result;
}

export function imageIdentity(resource: string): string {
  if (/^https?:\/\//i.test(resource)) {
    const url = new URL(resource);
    url.hash = "";
    return url.href;
  }
  return resource;
}

export function directImageMatches(
  markdown: string,
  quote: string,
): ImageReference[] {
  const first = imageReferences(quote)[0];
  if (!first) return [];
  const identity = imageIdentity(first.resource);
  return imageReferences(markdown).filter(
    (image) => imageIdentity(image.resource) === identity,
  );
}
