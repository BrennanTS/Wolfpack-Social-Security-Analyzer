import { describe, expect, it } from 'vitest';
import {
  namesFromParams,
  parseClient,
  parseClientsFile,
  serializeClients,
  suggestedClientLabel,
  type ClientRecord,
} from './clientRecord';

const record = (over: Partial<ClientRecord> = {}): ClientRecord => ({
  id: 'client-1',
  label: 'Dan and Sarah',
  names: { a: 'Dan', b: 'Sarah' },
  params: 'an=Dan&ay=1962&am=4&ag=m&ab=2400&bn=Sarah',
  savedAt: 1_757_000_000_000,
  ...over,
});

describe('saved clients', () => {
  it('survive export and import unchanged', () => {
    const back = parseClientsFile(serializeClients([record()]));
    expect(back).toEqual([record()]);
  });

  it('read a bare list, and a single record, as well as a file', () => {
    // A colleague pasting one record out of a file should still work.
    expect(parseClientsFile(JSON.stringify([record()]))?.[0].label).toBe('Dan and Sarah');
    expect(parseClientsFile(JSON.stringify(record()))?.[0].label).toBe('Dan and Sarah');
  });

  it('keep the rest of a file when one record is unreadable', () => {
    const file = JSON.stringify({ kind: 'wolfpack-clients', version: 1, clients: [{ junk: 1 }, record()] });
    expect(parseClientsFile(file)).toHaveLength(1);
  });

  it('refuse a record with no view to restore', () => {
    // The parameters are the record. A name with nothing behind it would
    // open a blank form and look like data loss.
    expect(parseClient({ label: 'Dan', names: {} })).toBeNull();
    expect(parseClient({ params: '   ' })).toBeNull();
    expect(parseClient(null)).toBeNull();
    expect(parseClient('client')).toBeNull();
  });

  it('name a record that arrived without one, rather than dropping it', () => {
    expect(parseClient({ params: 'ay=1962' })?.label).toBe('Untitled client');
  });

  it('tolerate a leading question mark, which is how a query string is copied', () => {
    expect(parseClient({ params: '?ay=1962', label: 'x' })?.params).toBe('ay=1962');
  });

  it('cap a pathological label and name rather than letting them into the list', () => {
    const parsed = parseClient({
      params: 'ay=1962',
      label: 'x'.repeat(500),
      names: { a: 'y'.repeat(500) },
    });
    expect(parsed?.label.length).toBeLessThanOrEqual(60);
    expect(parsed?.names.a?.length).toBeLessThanOrEqual(40);
  });

  it('drop an empty name rather than storing a blank one', () => {
    expect(parseClient({ params: 'ay=1962', names: { a: '  ', b: 'Sarah' } })?.names).toEqual({
      b: 'Sarah',
    });
  });

  it('take the names from the view, so the list cannot name a different household', () => {
    // The parameters are the record; the `names` field beside them is a copy
    // kept for the list, and a hand-edited file could have them disagree.
    const parsed = parseClient({
      params: 'an=Dan&bn=Sarah&ay=1962',
      names: { a: 'Someone', b: 'Else' },
    });
    expect(parsed?.names).toEqual({ a: 'Dan', b: 'Sarah' });
  });

  it('fall back to the stored names for a record written before names traveled', () => {
    expect(parseClient({ params: 'ay=1962', names: { a: 'Dan' } })?.names).toEqual({ a: 'Dan' });
  });
});

describe('namesFromParams', () => {
  it('reads both names, with or without a leading question mark', () => {
    expect(namesFromParams('?an=Dan&bn=Sarah')).toEqual({ a: 'Dan', b: 'Sarah' });
    expect(namesFromParams('an=Dan')).toEqual({ a: 'Dan' });
  });

  it('is empty for a view that carries no names', () => {
    expect(namesFromParams('ay=1962&ab=2400')).toEqual({});
  });

  it('refuse a stored view long enough to be a denial of service', () => {
    expect(parseClient({ params: 'a'.repeat(5000), label: 'x' })?.params.length).toBeLessThanOrEqual(
      2000,
    );
  });

  it('supply a date when a record carries no timestamp', () => {
    expect(parseClient({ params: 'ay=1962' })?.savedAt).toBeGreaterThan(0);
  });

  it('does not throw on malformed json', () => {
    expect(parseClientsFile('{not json')).toBeNull();
    expect(parseClientsFile('[]')).toBeNull();
  });
});

describe('suggestedClientLabel', () => {
  it('uses the names, which is what an adviser writes on the folder', () => {
    expect(suggestedClientLabel({ a: 'Dan', b: 'Sarah' })).toBe('Dan and Sarah');
    expect(suggestedClientLabel({ a: 'Dan' })).toBe('Dan');
  });

  it('falls back to the date when the household is unnamed', () => {
    // Names are optional in this app, so this is a real case rather than a
    // defensive one.
    expect(suggestedClientLabel({}, new Date(2026, 8, 7))).toMatch(/Saved /);
  });
});
