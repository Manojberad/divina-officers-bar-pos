// Silent single-instance runner for installed Divina Officers' Bar POS server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const DATA_DIR = path.join(SERVER_DIR, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

process.env.DATA_DIR = DATA_DIR;
process.env.CLIENT_DIST = path.join(ROOT, 'client', 'dist');
process.env.PORT = process.env.PORT || '4000';
process.env.HOST = '0.0.0.0';
process.chdir(SERVER_DIR);

// Rotate log if > 5 MB
const logFile = path.join(DATA_DIR, 'server.log');
try {
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) {
    fs.renameSync(logFile, path.join(DATA_DIR, 'server.prev.log'));
  }
} catch { /* ignore */ }

const logStream = fs.createWriteStream(logFile, { flags: 'a' });
const stamp = () => `[${new Date().toISOString()}] `;
const origOut = process.stdout.write.bind(process.stdout);
const origErr = process.stderr.write.bind(process.stderr);
process.stdout.write = (chunk, ...args) => { logStream.write(stamp() + chunk); return origOut(chunk, ...args); };
process.stderr.write = (chunk, ...args) => { logStream.write(stamp() + '[ERR] ' + chunk); return origErr(chunk, ...args); };

// Check if already listening cleanly on PORT before binding
try {
  const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
  if (res.ok) {
    console.log('Divina Bar POS server is already running on port ' + process.env.PORT);
    process.exit(0);
  }
} catch { /* not running yet -> start server */ }

// Set argv[1] so server/src/index.js starts listening automatically
const entry = path.join(SERVER_DIR, 'src', 'index.js');
process.argv[1] = entry;
await import(pathToFileURL(entry).href);
