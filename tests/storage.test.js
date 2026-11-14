const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const storage = require('../src/services/storage.service');
let dir;
const originalFetch = global.fetch;
beforeEach(async () => {
 process.env.SUPABASE_URL = 'https://storage-test.supabase.co';
 process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
 global.fetch = jest.fn().mockResolvedValue({ok:true});
 dir = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-test-'));
});
afterEach(async () => { global.fetch = originalFetch; await fs.rm(dir,{recursive:true,force:true}); delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY; });
test('uploads bytes with server key and returns encoded public URL', async () => {
 const file = path.join(dir,'test.png'); await fs.writeFile(file,'test');
 const url = await storage.upload('profile-photos','a b.png',{path:file,mimetype:'image/png'});
 expect(url).toBe('https://storage-test.supabase.co/storage/v1/object/public/profile-photos/a%20b.png');
 expect(global.fetch.mock.calls[0][1].headers.apikey).toBe('sb_secret_test');
 expect(global.fetch.mock.calls[0][1].body.toString()).toBe('test');
});
test('does not delete images owned by another host', async () => {
 await storage.removePublic('https://other.example/picture','profile-photos');
 expect(global.fetch).not.toHaveBeenCalled();
});
test('rejects traversal and sanitizes upstream errors', async () => {
 await expect(storage.remove('complaint-attachments',['../secret'])).rejects.toThrow('Invalid storage key');
 global.fetch.mockResolvedValue({ok:false,status:403});
 await expect(storage.remove('complaint-attachments',['folder/file'])).rejects.toMatchObject({message:'Storage request failed',status:502});
});
