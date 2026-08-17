#!/usr/bin/env node
/**
 * Zero-dependency static server for local play-testing.
 *
 *   node tools/serve.mjs            → http://localhost:5173
 *   node tools/serve.mjs --https    → https://<lan-ip>:5173 (self-signed)
 *
 * The HTTPS mode matters: iOS will not hand out DeviceMotion, and no browser
 * will hand out a microphone, on a plain-HTTP origin that is not localhost.
 */
import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, statSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5173);
const USE_HTTPS = process.argv.includes('--https');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function ensureCert() {
  const dir = join(ROOT, '.certs');
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  if (existsSync(key) && existsSync(cert)) return { key: readFileSync(key), cert: readFileSync(cert) };
  mkdirSync(dir, { recursive: true });
  const ip = lanAddress();
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
      '-keyout', key, '-out', cert,
      '-subj', '/CN=youman.local',
      '-addext', `subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${ip}`,
    ], { stdio: 'ignore' });
  } catch {
    console.error('openssl is required for --https. Install it, or tunnel instead:\n' +
      '  npx localtunnel --port 5173');
    process.exit(1);
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

const handler = (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = join(ROOT, normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache',
    // Sensors and the microphone must be explicitly permitted for this origin.
    'permissions-policy': 'accelerometer=(self), gyroscope=(self), microphone=(self)',
  });
  createReadStream(file).pipe(res);
};

const server = USE_HTTPS ? https.createServer(ensureCert(), handler) : http.createServer(handler);
server.listen(PORT, '0.0.0.0', () => {
  const scheme = USE_HTTPS ? 'https' : 'http';
  console.log(`\n  YOU MAN\n`);
  console.log(`  local   ${scheme}://localhost:${PORT}`);
  console.log(`  device  ${scheme}://${lanAddress()}:${PORT}`);
  if (!USE_HTTPS) console.log('\n  (run with --https to test the gyroscope and microphone on a phone)');
  console.log('');
});
