export type Chunk = {
  text: string;
  startChar: number;
  endChar: number;
};

export type ChunkOptions = {
  targetSize: number; // characters per chunk (approximate)
  overlap: number;    // characters of overlap between adjacent chunks
};

/**
 * Splits text into chunks of approximately targetSize characters,
 * overlapping by `overlap` characters. Prefers paragraph (\n\n) and
 * sentence (. ) boundaries when one is within ±10% of targetSize.
 */
export function splitText(text: string, options: ChunkOptions): Chunk[] {
  if (options.overlap >= options.targetSize) {
    throw new Error(
      `overlap (${options.overlap}) must be smaller than targetSize (${options.targetSize})`
    );
  }
  if (text.length <= options.targetSize) {
    return [{ text, startChar: 0, endChar: text.length }];
  }

  const chunks: Chunk[] = [];
  const tolerance = Math.floor(options.targetSize * 0.1);
  let pos = 0;

  while (pos < text.length) {
    const idealEnd = Math.min(text.length, pos + options.targetSize);
    let end = idealEnd;

    if (idealEnd < text.length) {
      // Look for a paragraph break within tolerance
      const paragraphIdx = text.lastIndexOf('\n\n', idealEnd);
      if (paragraphIdx >= idealEnd - tolerance && paragraphIdx > pos) {
        end = paragraphIdx;
      } else {
        // Fall back to sentence-ish break
        const sentenceIdx = Math.max(
          text.lastIndexOf('. ', idealEnd),
          text.lastIndexOf('.\n', idealEnd)
        );
        if (sentenceIdx >= idealEnd - tolerance && sentenceIdx > pos) {
          end = sentenceIdx + 1; // include the period
        }
      }
    }

    chunks.push({
      text: text.slice(pos, end),
      startChar: pos,
      endChar: end,
    });

    if (end >= text.length) break;
    pos = end - options.overlap;
  }

  return chunks;
}
