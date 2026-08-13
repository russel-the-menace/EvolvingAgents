export function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function tokenize(value) {
  const text = normalizeText(value);
  const words = text.match(/[\p{L}\p{N}_-]{2,}/gu) || [];
  const ideographs = text.match(/\p{Script=Han}/gu) || [];
  const bigrams = ideographs.slice(0, -1).map((character, index) => `${character}${ideographs[index + 1]}`);
  return [...new Set([...words, ...bigrams])].slice(0, 160);
}

export function lexicalScore(query, document) {
  const tokens = Array.isArray(query) ? query : tokenize(query);
  if (!tokens.length) return 0;
  const value = normalizeText(document);
  const matched = tokens.reduce((total, token) => total + (value.includes(token) ? 1 : 0), 0);
  return matched / Math.sqrt(tokens.length);
}
