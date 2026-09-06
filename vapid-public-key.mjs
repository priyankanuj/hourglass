export default async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return new Response(JSON.stringify({ error: 'VAPID_PUBLIC_KEY is not set on the server' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ publicKey }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

export const config = { path: '/api/vapid-public-key' };
