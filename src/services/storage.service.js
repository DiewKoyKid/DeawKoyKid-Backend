const fs = require('node:fs/promises');
const enabled = () => process.env.STORAGE_DRIVER === 'supabase';
function config() {
 const url = process.env.SUPABASE_URL;
 const key = process.env.SUPABASE_SECRET_KEY;
 if (!url || !key) throw new Error('Supabase Storage configuration is missing');
 const parsed = new URL(url);
 if (parsed.protocol !== 'https:') throw new Error('Supabase URL must use HTTPS');
 return { url: parsed.origin, key };
}
function objectPath(bucket, key) {
 if (!key || key.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid storage key');
 return encodeURIComponent(bucket) + '/' + key.split('/').map(encodeURIComponent).join('/');
}
async function request(path, options = {}) {
 const c = config();
 const response = await fetch(c.url + '/storage/v1/' + path, { ...options, headers: { apikey: c.key, ...(c.key.startsWith('eyJ') ? { Authorization: 'Bearer ' + c.key } : {}), ...options.headers }, signal: AbortSignal.timeout(30000) });
 if (!response.ok) { const error = new Error('Storage request failed'); error.status = response.status === 404 ? 404 : 502; throw error; }
 return response;
}
async function upload(bucket, key, file) {
 await request('object/' + objectPath(bucket, key), { method: 'POST', headers: { 'Content-Type': file.mimetype, 'x-upsert': 'false' }, body: await fs.readFile(file.path) });
 return config().url + '/storage/v1/object/public/' + objectPath(bucket, key);
}
async function remove(bucket, keys) {
 if (!keys.length) return;
 keys.forEach(key => objectPath(bucket, key));
 await request('object/' + encodeURIComponent(bucket), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: keys }) });
}
async function removePublic(url, bucket) {
 const prefix = config().url + '/storage/v1/object/public/' + encodeURIComponent(bucket) + '/';
 if (url?.startsWith(prefix)) await remove(bucket, [decodeURIComponent(url.slice(prefix.length))]);
}
async function download(bucket, key, res, name) {
 const response = await request('object/authenticated/' + objectPath(bucket, key));
 res.attachment(name);
 res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
 const { Readable } = require('node:stream');
 const { pipeline } = require('node:stream/promises');
 await pipeline(Readable.fromWeb(response.body), res);
}
module.exports = { enabled, config, upload, remove, removePublic, download };
