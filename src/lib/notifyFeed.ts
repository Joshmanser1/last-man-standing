const KEY = "lms_notifications_v1";
const VIEWED_KEY = "lms_notifications_viewed_v1";
const DISMISSED_KEY = "lms_notifications_dismissed_v1";

function getPlayerKey(playerId: string) {
  return `${KEY}:${playerId}`;
}

function getDismissedKey(playerId: string) {
  return `${DISMISSED_KEY}:${playerId}`;
}

function getDismissedNotificationKeys(playerId: string) {
  return JSON.parse(localStorage.getItem(getDismissedKey(playerId)) || "[]") as string[];
}

export function appendNotification(playerId: string, item: any) {
  const k = getPlayerKey(playerId);
  const raw = localStorage.getItem(k) || "[]";
  const arr = JSON.parse(raw);
  const dismissed = getDismissedNotificationKeys(playerId);
  if (item?.key && dismissed.includes(item.key)) return;
  if (item?.key && arr.some((x: any) => x.key === item.key)) return;

  arr.unshift({
    id: crypto.randomUUID(),
    ts: Date.now(),
    read: false,
    ...item,
  });

  localStorage.setItem(k, JSON.stringify(arr.slice(0, 50)));
}

export function getNotifications(playerId: string) {
  const k = getPlayerKey(playerId);
  return JSON.parse(localStorage.getItem(k) || "[]");
}

export function markAllRead(playerId: string) {
  const k = getPlayerKey(playerId);
  const arr = JSON.parse(localStorage.getItem(k) || "[]");
  arr.forEach((x: any) => (x.read = true));
  localStorage.setItem(k, JSON.stringify(arr));
  setLastViewedAt(playerId);
}

export function clearNotifications(playerId: string) {
  const arr = getNotifications(playerId);
  const dismissed = new Set(getDismissedNotificationKeys(playerId));
  arr.forEach((item: any) => {
    if (item?.key) dismissed.add(item.key);
  });
  localStorage.setItem(getDismissedKey(playerId), JSON.stringify(Array.from(dismissed)));
  localStorage.removeItem(getPlayerKey(playerId));
  localStorage.removeItem(`${VIEWED_KEY}:${playerId}`);
}

export function getUnreadCount(playerId: string) {
  const arr = getNotifications(playerId);
  const lastViewedAt = getLastViewedAt(playerId);
  return arr.filter((x: any) => x.ts > lastViewedAt).length;
}

export function markRead(playerId: string, id: string) {
  const k = getPlayerKey(playerId);
  const arr = JSON.parse(localStorage.getItem(k) || "[]");
  const idx = arr.findIndex((x: any) => x.id === id);
  if (idx >= 0) {
    arr[idx].read = true;
    localStorage.setItem(k, JSON.stringify(arr));
  }
}

export function getLastViewedAt(playerId: string) {
  return Number(localStorage.getItem(`${VIEWED_KEY}:${playerId}`) || "0");
}

export function setLastViewedAt(playerId: string, ts = Date.now()) {
  localStorage.setItem(`${VIEWED_KEY}:${playerId}`, String(ts));
}
