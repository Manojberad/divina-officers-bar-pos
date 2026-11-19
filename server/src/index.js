import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, UPLOAD_DIR, q } from './db.js';
import { optionalAuth } from './auth.js';
import { sseHandler } from './events.js';
import { seed } from './seed.js';
import { startJobs } from './jobs.js';
import { lanAddresses } from './routes/tables.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import catalogRoutes from './routes/catalog.js';
import orderRoutes from './routes/orders.js';
import inventoryRoutes from './routes/inventory.js';
import tableRoutes from './routes/tables.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';

migrate();
if (!q.get('SELECT id FROM users LIMIT 1')) seed();

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/events', optionalAuth, sseHandler);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api', catalogRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
const ASSETS_IMG = path.resolve(__dirname, '../../Assets/img');
if (fs.existsSync(ASSETS_IMG)) {
  app.get(/^\/Login_bg\.(png|jpg|jpeg|webp)$/i, (_req, res, next) => {
    const files = fs.readdirSync(ASSETS_IMG)
      .filter((f) => /^Login_bg\.(webp|png|jpg|jpeg)$/i.test(f))
      .map((f) => ({ f, mtime: fs.statSync(path.join(ASSETS_IMG, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(ASSETS_IMG, files[0].f));
  });
  app.use(express.static(ASSETS_IMG, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
}
const CLIENT_DIST = process.env.CLIENT_DIST || path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false, setHeaders: (res, p) => { if (p.endsWith('sw.js') || p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.code === 'ERR_SQLITE_ERROR' && /UNIQUE/.test(err.message) ? 409 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const key = process.env.HTTPS_KEY, cert = process.env.HTTPS_CERT;
  const server = key && cert ? https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, app) : http.createServer(app);
  server.listen(PORT, HOST, () => {
    const proto = key && cert ? 'https' : 'http';
    console.log(`\n  BarTill server running (offline, single authoritative DB)`);
    console.log(`  Local:   ${proto}://localhost:${PORT}`);
    lanAddresses().forEach((a) => console.log(`  Network: ${proto}://${a}:${PORT}`));
    console.log('');
  });
  startJobs();
}
