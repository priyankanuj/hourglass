// notifications.js — on-device reminders, used only when this app is running
// inside a Capacitor-wrapped native shell (see README: "Option B").
// On a plain web page / installed PWA, window.Capacitor won't exist, every
// function here becomes a no-op, and the caller should fall back to the
// server-push flow already built into app.js.

export function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function getPlugin() {
  return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
}

function hoursInWindow(startHour, endHour) {
  const list = [];
  if (startHour === endHour) return list;
  if (startHour < endHour) {
    for (let h = startHour; h < endHour; h++) list.push(h);
  } else {
    // window wraps past midnight, e.g. 22 -> 6
    for (let h = startHour; h < 24; h++) list.push(h);
    for (let h = 0; h < endHour; h++) list.push(h);
  }
  return list;
}

export async function scheduleLocalHourlyReminders(startHour, endHour) {
  const LocalNotifications = getPlugin();
  if (!LocalNotifications) {
    throw new Error('On-device reminders only work inside the installed Android app, not in a browser.');
  }

  const perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  // Clear anything previously scheduled before re-scheduling the new window.
  const pending = await LocalNotifications.getPending();
  if (pending.notifications && pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications });
  }

  const hours = hoursInWindow(startHour, endHour);
  const notifications = hours.map(h => ({
    id: 1000 + h, // stable id per hour-of-day so re-scheduling replaces cleanly
    title: 'Log your last hour',
    body: 'Energy, actions, and any to-dos you finished — takes 15 seconds.',
    schedule: { on: { hour: h, minute: 0 }, repeats: true, allowWhileIdle: true }
  }));

  if (notifications.length) {
    await LocalNotifications.schedule({ notifications });
  }
}

export async function cancelLocalReminders() {
  const LocalNotifications = getPlugin();
  if (!LocalNotifications) return;
  const pending = await LocalNotifications.getPending();
  if (pending.notifications && pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications });
  }
}
