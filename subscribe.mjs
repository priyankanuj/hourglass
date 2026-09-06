import { getStore } from '@netlify/blobs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { deviceId, enabled } = body;
  if (!deviceId) {
    return new Response(JSON.stringify({ error: 'deviceId is required' }), { status: 400 });
  }

  const store = getStore('subscriptions');

  if (enabled === false) {
    await store.delete(deviceId);
    return new Response(JSON.stringify({ ok: true, removed: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { subscription, startHour, endHour, tzOffsetHours } = body;
  if (!subscription || typeof startHour !== 'number' || typeof endHour !== 'number') {
    return new Response(JSON.stringify({ error: 'subscription, startHour and endHour are required' }), { status: 400 });
  }

  await store.setJSON(deviceId, {
    subscription,
    enabled: true,
    startHour,
    endHour,
    tzOffsetHours: tzOffsetHours || 0,
    updatedAt: Date.now()
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

export const config = { path: '/api/subscribe' };
