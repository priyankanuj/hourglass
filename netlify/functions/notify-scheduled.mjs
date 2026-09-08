import webpush from 'web-push';
import { getStore } from '@netlify/blobs';

export default async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const contact = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com';

  if (!publicKey || !privateKey) {
    console.error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set — skipping this run.');
    return new Response('Missing VAPID keys', { status: 500 });
  }

  webpush.setVapidDetails(contact, publicKey, privateKey);

  const store = getStore('subscriptions');
  const { blobs } = await store.list();
  const now = new Date();
  const utcHour = now.getUTCHours();

  let sent = 0, skipped = 0, removed = 0;

  for (const meta of blobs) {
    const data = await store.get(meta.key, { type: 'json' });
    if (!data || !data.enabled || !data.subscription) { skipped++; continue; }

    const localHour = ((utcHour + (data.tzOffsetHours || 0)) % 24 + 24) % 24;
    const { startHour, endHour } = data;
    const inWindow = startHour <= endHour
      ? (localHour >= startHour && localHour < endHour)
      : (localHour >= startHour || localHour < endHour); // window wraps past midnight

    if (!inWindow) { skipped++; continue; }

    try {
      await webpush.sendNotification(data.subscription, JSON.stringify({
        title: 'Log your last hour',
        body: 'Energy, actions, and any to-dos you finished — takes 15 seconds.'
      }));
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await store.delete(meta.key);
        removed++;
      } else {
        console.error('Push failed for', meta.key, err.message);
      }
    }
  }

  return new Response(JSON.stringify({ sent, skipped, removed }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

export const config = { schedule: '@hourly' };
