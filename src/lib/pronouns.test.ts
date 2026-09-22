import { describe, expect, it } from 'vitest';
import { capitalize, pronounsFor } from './pronouns';

describe('pronounsFor', () => {
  it('names a person the report knows', () => {
    expect(pronounsFor('female').possessive).toBe('her');
    expect(pronounsFor('male').possessive).toBe('his');
    expect(pronounsFor('female').object).toBe('her');
    expect(pronounsFor('male').object).toBe('him');
    expect(pronounsFor('female').subject).toBe('she');
    expect(pronounsFor('male').subject).toBe('he');
  });

  it('falls back to they/them when the field is not set', () => {
    // The gender field is optional and a household can reach the report
    // without it. They/them is correct for everyone, which is why it is the
    // fallback rather than a guess or an empty string.
    expect(pronounsFor(null).subject).toBe('they');
    expect(pronounsFor(undefined).possessive).toBe('their');
  });

  it('agrees the verb, because "they" is plural even for one person', () => {
    // The trap this exists for: swapping the pronoun alone turns "they have
    // not filed" into "she have not filed".
    expect(pronounsFor(null).verb('has', 'have')).toBe('have');
    expect(pronounsFor('female').verb('has', 'have')).toBe('has');
    expect(pronounsFor('male').verb('is', 'are')).toBe('is');
    expect(pronounsFor(null).verb('is', 'are')).toBe('are');
  });

  it('capitalizes for the start of a sentence', () => {
    expect(capitalize(pronounsFor('male').subject)).toBe('He');
    expect(capitalize(pronounsFor(null).subject)).toBe('They');
    expect(capitalize('')).toBe('');
  });
});
