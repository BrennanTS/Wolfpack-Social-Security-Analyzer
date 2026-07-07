type RawLifeTable = { x: number; q_x: number }[];

const tables = import.meta.glob('../../public/data/processed/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, RawLifeTable>;

export function getBundledLifeTable(
  gender: 'male' | 'female',
  year: number,
): RawLifeTable | null {
  const key = `../../public/data/processed/${gender}_${year}.json`;
  return tables[key] ?? null;
}
