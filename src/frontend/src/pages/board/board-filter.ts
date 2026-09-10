import type { WorkItem } from '../../types';

/** Case-insensitive match on key, title, description, type, and assigned agent. */
export function workItemMatchesQuery(item: WorkItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.key,
    item.title,
    item.description ?? '',
    item.type,
    item.assignedAgentType ?? '',
    ...(item.labels ?? []),
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(q);
}

export function filterWorkItems(items: WorkItem[] | undefined, query: string): WorkItem[] {
  if (!items?.length) return [];
  return items.filter((item) => workItemMatchesQuery(item, query));
}
