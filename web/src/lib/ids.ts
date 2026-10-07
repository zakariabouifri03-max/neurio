import { customAlphabet } from 'nanoid';

/** Sortable, URL-safe, collision-resistant ids (same shape on every entity). */
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
const nano = customAlphabet(alphabet, 16);

export function newId(prefix = ''): string {
  const time = Date.now().toString(36).padStart(9, '0');
  const id = `${time}${nano(10)}`;
  return prefix ? `${prefix}_${id}` : id;
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item'
  );
}
