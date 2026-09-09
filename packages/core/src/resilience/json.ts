import type { z } from 'zod';

/**
 * PLAN.md §4.5 — "The model returns invalid JSON or an incomplete kit" is a listed edge
 * case. Recover locally first; only escalate to a repair call if that fails.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string; raw: string };

export function parseJson<T>(text: string, schema: z.ZodType<T>): ParseResult<T> {
  const candidates = [text, stripFences(text), extractOutermostJson(text)].filter(
    (c): c is string => typeof c === 'string' && c.trim().length > 0,
  );

  let lastError = 'no JSON found in the response';
  for (const candidate of candidates) {
    let data: unknown;
    try {
      data = JSON.parse(candidate);
    } catch (e) {
      lastError = `not valid JSON: ${(e as Error).message}`;
      continue;
    }
    const parsed = schema.safeParse(data);
    if (parsed.success) return { ok: true, value: parsed.data };
    lastError = parsed.error.issues
      .slice(0, 4)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
  }
  return { ok: false, error: lastError, raw: text.slice(0, 400) };
}

function stripFences(text: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return m?.[1]?.trim() ?? '';
}

/** Brace/bracket matching that ignores delimiters inside strings. */
export function extractOutermostJson(text: string): string {
  const start = text.search(/[[{]/);
  if (start === -1) return '';
  const open = text[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

/** A one-line description of a Zod failure, suitable for feeding back to the model. */
export function describeSchemaError(error: string): string {
  return `Your previous reply did not match the required JSON shape (${error}). Return ONLY valid JSON matching the schema, with no commentary.`;
}
