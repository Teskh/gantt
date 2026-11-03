// Evaluates a typed arithmetic formula such as "10*20" or "(12,5 + 7.5) x 4".
// Supports + - * / with parentheses and unary minus. "x" and "×" also multiply,
// and a comma works as the decimal mark. Returns null for anything else.
export function evaluateExpression(input: string): number | null {
  const source = input.replace(/,/g, '.').replace(/[x×]/gi, '*').replace(/÷/g, '/');
  let pos = 0;

  const skipSpaces = () => {
    while (source[pos] === ' ' || source[pos] === '\t') pos++;
  };

  const parseNumber = (): number | null => {
    skipSpaces();
    const match = /^(\d+(\.\d*)?|\.\d+)/.exec(source.slice(pos));
    if (!match) return null;
    pos += match[0].length;
    return Number(match[0]);
  };

  const parseFactor = (): number | null => {
    skipSpaces();
    if (source[pos] === '-' || source[pos] === '+') {
      const sign = source[pos++] === '-' ? -1 : 1;
      const value = parseFactor();
      return value === null ? null : sign * value;
    }
    if (source[pos] === '(') {
      pos++;
      const value = parseSum();
      skipSpaces();
      if (value === null || source[pos] !== ')') return null;
      pos++;
      return value;
    }
    return parseNumber();
  };

  const parseProduct = (): number | null => {
    let value = parseFactor();
    while (value !== null) {
      skipSpaces();
      const op = source[pos];
      if (op !== '*' && op !== '/') break;
      pos++;
      const right = parseFactor();
      if (right === null) return null;
      value = op === '*' ? value * right : value / right;
    }
    return value;
  };

  function parseSum(): number | null {
    let value = parseProduct();
    while (value !== null) {
      skipSpaces();
      const op = source[pos];
      if (op !== '+' && op !== '-') break;
      pos++;
      const right = parseProduct();
      if (right === null) return null;
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  const result = parseSum();
  skipSpaces();
  if (result === null || pos !== source.length || !Number.isFinite(result)) return null;
  return result;
}
