import { describe, expect, it } from 'vitest';
import { evaluateExpression } from './math-expression';

describe('evaluateExpression', () => {
  it('reads plain numbers', () => {
    expect(evaluateExpression('200')).toBe(200);
    expect(evaluateExpression(' 12,5 ')).toBe(12.5);
  });

  it('evaluates formulas with precedence and parentheses', () => {
    expect(evaluateExpression('10*20')).toBe(200);
    expect(evaluateExpression('10 x 20 + 5')).toBe(205);
    expect(evaluateExpression('(10 + 5) * 4')).toBe(60);
    expect(evaluateExpression('100 / 4 - -5')).toBe(30);
    expect(evaluateExpression('3×7,5')).toBe(22.5);
  });

  it('rejects anything that is not arithmetic', () => {
    expect(evaluateExpression('')).toBeNull();
    expect(evaluateExpression('10*')).toBeNull();
    expect(evaluateExpression('(1+2')).toBeNull();
    expect(evaluateExpression('alert(1)')).toBeNull();
    expect(evaluateExpression('5/0')).toBeNull();
  });
});
