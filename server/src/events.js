// Minimal Server-Sent-Events hub for live order updates across devices on the LAN.
const clients = new Set();

export function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  const c = { res, user: req.user };
  clients.add(c);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(c); });
}

export function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    // Non-staff only receive events about their own orders (and guests/public receive guest_request updates)
    if (event === 'order' && c.user && ['customer', 'member', 'guest'].includes(c.user.role) && data?.user_id && data.user_id !== c.user.id) continue;
    try { c.res.write(msg); } catch { /* ignore */ }
  }
}
