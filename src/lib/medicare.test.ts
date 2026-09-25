import { describe, expect, it } from 'vitest';
import { medicareStartsAutomatically } from './medicare';

/**
 * Medicare enrolls automatically only when Social Security payments start at
 * least four months before 65. The action plan's gate was "by 65", which told
 * a client starting one to three months before 65 that they need do nothing.
 */
describe('medicareStartsAutomatically', () => {
  const sixtyFive = 2030 * 12 + 6;

  it('is automatic when payments start four or more months before 65', () => {
    expect(medicareStartsAutomatically(sixtyFive - 4, sixtyFive)).toBe(true);
    expect(medicareStartsAutomatically(sixtyFive - 36, sixtyFive)).toBe(true);
  });

  it('is not automatic when payments start one to three months before 65', () => {
    // The months the old gate got wrong.
    for (const lead of [1, 2, 3]) {
      expect(medicareStartsAutomatically(sixtyFive - lead, sixtyFive)).toBe(false);
    }
  });

  it('is not automatic when payments start at or after 65', () => {
    expect(medicareStartsAutomatically(sixtyFive, sixtyFive)).toBe(false);
    expect(medicareStartsAutomatically(sixtyFive + 24, sixtyFive)).toBe(false);
  });
});
