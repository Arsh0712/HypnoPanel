/**
 * Document-title manager — per-view titles (FIX#2 §2) + unread alert badge,
 * kept in one place so they never fight over document.title.
 */

let baseTitle = "HipnoType Panel";
let unreadCount = 0;

function current(): string {
  return unreadCount > 0 ? `(${unreadCount}) ${baseTitle}` : baseTitle;
}

function render(): void {
  if (typeof document !== "undefined") document.title = current();
}

/** Set the view-scoped base title, e.g. "Domains & DNS · HipnoType". */
export function setPanelViewTitle(viewLabel: string | null): void {
  baseTitle = viewLabel ? `${viewLabel} · HipnoType` : "HipnoType Panel";
  render();
}

/** Set the unread-alerts count shown as "(n)" before the base title. */
export function setUnreadTitleCount(n: number): void {
  unreadCount = Math.max(0, Math.floor(n || 0));
  render();
}
