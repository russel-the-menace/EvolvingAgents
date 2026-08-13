function semanticSegments(content) {
  const text = String(content || '').replace(/\r\n?/g, '\n');
  const matches = [...text.matchAll(/(?:^|\n)(?:#{1,6}\s+[^\n]+|[^\n]+)(?:\n(?!\s*$)[^\n]+)*/g)];
  if (!matches.length) return [{ text, startOffset: 0, endOffset: text.length }];
  return matches.map((match) => {
    const leadingBreak = match[0].startsWith('\n') ? 1 : 0;
    const value = match[0].slice(leadingBreak).trim();
    const startOffset = (match.index || 0) + leadingBreak + match[0].slice(leadingBreak).indexOf(value);
    return { text: value, startOffset, endOffset: startOffset + value.length };
  }).filter((segment) => segment.text);
}

function hardSplit(segment, maxChars, overlapChars) {
  const chunks = [];
  let cursor = 0;
  while (cursor < segment.text.length) {
    const end = Math.min(cursor + maxChars, segment.text.length);
    const text = segment.text.slice(cursor, end).trim();
    const trimStart = segment.text.slice(cursor, end).indexOf(text);
    const startOffset = segment.startOffset + cursor + Math.max(trimStart, 0);
    chunks.push({ text, startOffset, endOffset: startOffset + text.length });
    if (end === segment.text.length) break;
    cursor = Math.max(end - overlapChars, cursor + 1);
  }
  return chunks;
}

export function chunkDocument(content, options = {}) {
  const maxChars = Math.max(400, options.maxChars || 6000);
  const overlapChars = Math.min(Math.max(0, options.overlapChars || 300), Math.floor(maxChars / 3));
  const segments = semanticSegments(content).flatMap((segment) => segment.text.length > maxChars
    ? hardSplit(segment, maxChars, overlapChars)
    : [segment]);
  const chunks = [];
  let current = null;
  for (const segment of segments) {
    if (!current) {
      current = { ...segment };
      continue;
    }
    const combinedLength = current.text.length + 2 + segment.text.length;
    if (combinedLength <= maxChars) {
      current.text += `\n\n${segment.text}`;
      current.endOffset = segment.endOffset;
      continue;
    }
    chunks.push(current);
    current = { ...segment };
  }
  if (current) chunks.push(current);
  return chunks.map((chunk, ordinal) => ({ id: `chunk-${ordinal}`, ordinal, ...chunk }));
}

export function locateEvidence(chunk, value) {
  const text = String(value || '').trim();
  const relativeOffset = text ? chunk.text.indexOf(text) : -1;
  if (relativeOffset >= 0) {
    return {
      text,
      startOffset: chunk.startOffset + relativeOffset,
      endOffset: chunk.startOffset + relativeOffset + text.length,
      attributes: { offsetPrecision: 'exact' },
    };
  }
  return {
    text: text || chunk.text,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    attributes: { offsetPrecision: 'chunk' },
  };
}
