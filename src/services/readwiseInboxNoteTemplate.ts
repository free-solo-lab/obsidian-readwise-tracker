export interface ReadwiseInboxNoteTemplateInput {
  title: string;
  created: string;
  bookLink: string;
  sourceLink: string;
  sourceDate?: string;
  quote?: string;
  description?: string;
}

export function buildReadwiseInboxNoteFileBaseName(title: string): string {
  return sanitizeFileName(title) || "Readwise highlight";
}

export function buildReadwiseInboxNoteContent(input: ReadwiseInboxNoteTemplateInput): string {
  const parts: string[] = [];
  parts.push("---");
  parts.push("type: inbox");
  parts.push(`created: ${input.created}`);
  parts.push(`book: ${yamlString(input.bookLink)}`);
  parts.push(`source: ${yamlString(input.sourceLink)}`);
  if (input.sourceDate) {
    parts.push(`date: ${input.sourceDate}`);
  }
  parts.push("---");

  const quote = input.quote?.trim();
  if (quote) {
    parts.push("");
    for (const line of quote.split("\n")) {
      parts.push(`> ${line}`);
    }
  }

  const description = input.description?.trim();
  if (description) {
    parts.push("");
    parts.push(description);
  }

  parts.push("");
  return parts.join("\n");
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
