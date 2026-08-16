export function parseModelJson(content) {
  const cleaned = String(content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch (originalError) {
    const objectStart = cleaned.indexOf('{');
    const arrayStart = cleaned.indexOf('[');
    const start = objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart);
    if (start < 0) throw originalError;
    const stack = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < cleaned.length; index += 1) {
      const character = cleaned[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') stack.push('}');
      else if (character === '[') stack.push(']');
      else if (character === '}' || character === ']') {
        if (stack.pop() !== character) throw originalError;
        if (!stack.length) return JSON.parse(cleaned.slice(start, index + 1));
      }
    }
    throw originalError;
  }
}
