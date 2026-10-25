import postgres from 'postgres';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createBackup, restoreBackup } from '../src/lib/backup';

const sourceUrl = process.env.DATABASE_URL;
const targetUrl = process.env.NEON_TARGET_DATABASE_URL;
if (!sourceUrl || !targetUrl) throw new Error('DATABASE_URL and NEON_TARGET_DATABASE_URL are required.');
if (new URL(sourceUrl).hostname !== '127.0.0.1') throw new Error('Source must be local Postgres.');
if (!new URL(targetUrl).hostname.endsWith('.neon.tech')) throw new Error('Target must be Neon Postgres.');

const source = postgres(sourceUrl, { max: 1 });
const target = postgres(targetUrl, { max: 1 });
try {
  const backup = await createBackup(source);
  const dir = path.resolve('backups');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const filename = path.join(dir, `before-neon-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(filename, JSON.stringify(backup), { mode: 0o600, flag: 'wx' });
  const originalFiles = await source`select id, file_path from import_batches where file_path is not null and expires_at > now()`;
  await restoreBackup(target, backup);
  let restoredFiles = 0;
  for (const row of originalFiles) {
    const filePath = String(row.file_path);
    if (!/^[a-f0-9-]{36}\.upload$/.test(filePath)) continue;
    try { await access(path.resolve(process.env.STORAGE_DIR || './storage', filePath)); }
    catch { continue; }
    await target`update import_batches set file_path=${filePath} where id=${row.id}`;
    restoredFiles++;
  }
  for (const table of ['tenants', 'admins', 'people', 'import_batches', 'import_rows', 'trips', 'participation', 'timeline_events', 'line_events', 'tasks', 'segment_runs'] as const) {
    const [src] = await source`select count(*)::int as n from ${source(table)}`;
    const [dst] = await target`select count(*)::int as n from ${target(table)}`;
    if (src.n !== dst.n) throw new Error(`Count mismatch in ${table}: local ${src.n}, Neon ${dst.n}`);
    console.log(`${table}: ${dst.n}`);
  }
  console.log(`Migration verified. Active upload files retained: ${restoredFiles}. Private local backup: ${filename}`);
} finally {
  await source.end();
  await target.end();
}
