const KEY = "lms_notifications_v1";

function getPlayerKey(playerId: string) {
  return `${KEY}:${playerId}`;
}

export function appendNotification(playerId: string, item: any) {
  const k = getPlayerKey(playerId);
  const raw = localStorage.getItem(k) || "[]";
  const arr = JSON.parse(raw);

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
}

export function clearNotifications(playerId: string) {
  localStorage.removeItem(getPlayerKey(playerId));
}
