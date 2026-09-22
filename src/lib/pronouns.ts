/**
 * Pronouns for one named person in the report's prose.
 *
 * Sentences about a specific claimant used to read "…has not filed on their
 * own record", beside that person's name and a benefit figure. It is not
 * wrong, but it is the register of a form rather than of a letter, and an
 * adviser hands this to the person it is about.
 *
 * DRIVEN BY `Person.gender`, WHICH IS COLLECTED FOR A DIFFERENT PURPOSE.
 * That field picks the SSA period life table
 * (`lifeExpectancy.ts`), and "which mortality table applies" and "what to
 * call someone" are not the same question — SSA publishes two tables, people
 * are not two kinds. Anyone whose pronouns do not follow from the table they
 * are priced on will be misnamed in a document they are handed. Everything
 * routes through this one function so that stays a one-line change if a
 * pronoun field is ever added beside the gender one; nothing else in the app
 * turns a gender into a word.
 *
 * `null` — the field is optional, and a person can reach the report without
 * it — falls back to they/them, which is correct for everyone.
 */
import type { Gender } from './lifeExpectancy';

export interface Pronouns {
  /** he / she / they */
  subject: string;
  /** him / her / them */
  object: string;
  /** his / her / their */
  possessive: string;
  /**
   * Whether this pronoun takes plural verb forms. True only for "they", which
   * is singular in meaning and plural in agreement — "they have", never "they
   * has". Read it through `verb`.
   */
  plural: boolean;
  /**
   * The form of a verb that agrees with `subject`:
   * `` `${p.subject} ${p.verb('has', 'have')} filed` ``.
   *
   * A function rather than a table of conjugated verbs, because the set of
   * verbs the copy needs is not knowable from here and a table would be
   * extended by whoever wrote the next sentence — or, more likely, not.
   */
  verb(singular: string, plural: string): string;
}

const THEY: Pronouns = {
  subject: 'they',
  object: 'them',
  possessive: 'their',
  plural: true,
  verb: (_singular, plural) => plural,
};

const HE: Pronouns = {
  subject: 'he',
  object: 'him',
  possessive: 'his',
  plural: false,
  verb: (singular) => singular,
};

const SHE: Pronouns = {
  subject: 'she',
  object: 'her',
  possessive: 'her',
  plural: false,
  verb: (singular) => singular,
};

export function pronounsFor(gender: Gender | null | undefined): Pronouns {
  if (gender === 'male') return HE;
  if (gender === 'female') return SHE;
  return THEY;
}

/** A pronoun at the start of a sentence. */
export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
