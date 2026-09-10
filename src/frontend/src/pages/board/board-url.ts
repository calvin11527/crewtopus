/** Board URL: `/board?sprint=<id|all>&item=<workItemId>` */

export interface BoardUrlState {
  /** `undefined` = auto active sprint; `null` = All items; string = sprint id. */
  sprintId: string | null | undefined;
  itemId: string | null;
}

export function parseBoardSearchParams(search: URLSearchParams): BoardUrlState {
  const sprintRaw = search.get('sprint');
  const itemRaw = search.get('item');
  let sprintId: string | null | undefined;
  if (sprintRaw == null) sprintId = undefined;
  else if (sprintRaw === '' || sprintRaw === 'all') sprintId = null;
  else sprintId = sprintRaw;

  return {
    sprintId,
    itemId: itemRaw && itemRaw.trim() ? itemRaw.trim() : null,
  };
}

export function buildBoardSearchParams(
  current: URLSearchParams,
  next: { sprint?: string | null | undefined; item?: string | null }
): URLSearchParams {
  const params = new URLSearchParams(current);
  if (next.sprint !== undefined) {
    if (next.sprint === null) params.set('sprint', 'all');
    else params.set('sprint', next.sprint);
  }
  if (next.item !== undefined) {
    if (next.item) params.set('item', next.item);
    else params.delete('item');
  }
  return params;
}
