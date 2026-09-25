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
  it('dates the estimated benefit by the death, and says it includes the increases', () => {
    // It said "a check includes every cost-of-living rise since he filed and
    // this figure includes none", which was wrong twice: SSA applies the
    // increases from the year a person turns 62, not from the filing, and
    // `deceasedPia` removes none of them, so the recovered figure carries
    // every increase the last check did. The fixture filed in 2017 and died
    // in 2021, so the year printed discriminates between the two.
    const note = piaEstimateNote(DECEASED, true)!;
    expect(note).toContain('includes the cost-of-living increases paid up to that check');
    expect(note).toContain('is in 2021 dollars');
    expect(note).not.toContain('2017');
    expect(note).not.toMatch(/since (he|she|they) filed/);
    expect(note).not.toContain('includes none');
  });

  it('agrees the verb in the survivor card', () => {
    // "they were receiving" but "she was receiving" — the trap a plain
    // find-and-replace on the pronoun walks straight into.
    expect(widowedSurvivorCard('female')).toContain('what she was receiving and 82.5% of her');
    expect(widowedSurvivorCard('male')).toContain('what he was receiving and 82.5% of his');
    expect(widowedSurvivorCard(null)).toContain('what they were receiving and 82.5% of their');
  });

  it('states the widow(er)’s limit as the larger of the two, not a cap at what was received', () => {
    // It said the survivor benefit "is capped at what he was receiving", the
    // opposite of the rule the rest of the report explains: for an early
    // filer the ceiling is the LARGER of that and 82.5% of the full benefit,
    // which is why a survivor can be paid more than the deceased received.
    const card = widowedSurvivorCard('male');
    expect(card).toContain('limited to the larger of');
    expect(card).not.toMatch(/capped at what/);
  });

  it('keeps the rules around it impersonal', () => {
    // The age floor and the reduction schedule are rules, true of every
    // household. Only the last clause is about this one's deceased spouse.
    for (const gender of ['male', 'female', null] as const) {
      const card = widowedSurvivorCard(gender);
      expect(card).toContain('can start at 60');
      expect(card).toContain('survivor’s full retirement age');
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
