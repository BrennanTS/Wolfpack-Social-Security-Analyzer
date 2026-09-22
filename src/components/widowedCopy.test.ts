import { describe, expect, it } from 'vitest';
import type { DeceasedSummary } from '../lib/household';
import { piaEstimateNote, widowedIncomeCaption, widowedSurvivorCard } from './widowedCopy';

const DECEASED: DeceasedSummary = {
  birthYear: 1955,
  birthMonth: 4,
  deathYear: 2021,
  deathMonth: 8,
  gender: null,
  piaMonthly: 2400,
  filed: { year: 2017, month: 6 },
};

/**
 * Prose about the deceased spouse.
 *
 * These three sentences are the ones a widow(er) reads about the person who
 * died. "A check includes every cost-of-living rise since they filed" is not
 * wrong, but it is the register of a form, and the deceased-spouse form now
 * has a field that lets it be better. It is optional, so they/them has to
 * stay grammatical — which is the half of this that is easy to break.
 */
describe('prose about the deceased spouse', () => {
  it('uses the pronoun the form was given', () => {
    const note = (gender: 'male' | 'female' | null) =>
      piaEstimateNote({ ...DECEASED, gender }, true)!;
    expect(note('male')).toContain('every cost-of-living rise since he filed');
    expect(note('female')).toContain('every cost-of-living rise since she filed');
    expect(note(null)).toContain('every cost-of-living rise since they filed');
  });

  it('agrees the verb in the survivor card', () => {
    // "they were receiving" but "she was receiving" — the trap a plain
    // find-and-replace on the pronoun walks straight into.
    expect(widowedSurvivorCard('female')).toContain('capped at what she was receiving');
    expect(widowedSurvivorCard('male')).toContain('capped at what he was receiving');
    expect(widowedSurvivorCard(null)).toContain('capped at what they were receiving');
  });

  it('keeps the rules around it impersonal', () => {
    // The age floor and the reduction schedule are rules, true of every
    // household. Only the last clause is about this one's deceased spouse.
    for (const gender of ['male', 'female', null] as const) {
      const card = widowedSurvivorCard(gender);
      expect(card).toContain('payable from age 60');
      expect(card).toContain('survivor full retirement age');
    }
  });

  it('says nothing at all when the PIA was not estimated', () => {
    expect(piaEstimateNote({ ...DECEASED, gender: 'female' }, false)).toBeNull();
  });

  it('gives the survivor their own pronoun in the income caption', () => {
    // A different person from the deceased — the one still living, whose
    // gender the claimant form already carries.
    const caption = (gender: 'male' | 'female' | null) =>
      widowedIncomeCaption('real', false, gender);
    expect(caption('female')).toContain('the survivor benefit stops the month her own begins');
    expect(caption('male')).toContain('stops the month his own begins');
    expect(caption(null)).toContain('stops the month their own begins');
  });
});
