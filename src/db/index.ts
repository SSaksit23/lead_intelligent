import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
const globalDb = globalThis as unknown as { leadSql?: ReturnType<typeof postgres>; leadOrmSql?: ReturnType<typeof postgres> };
export function getSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy .env.example to .env and configure Postgres.');
  return globalDb.leadSql ??= postgres(process.env.DATABASE_URL,{max:5, idle_timeout:20, connect_timeout:10});
}
export function getDb() {
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required.');
  // Drizzle customizes postgres-js JSON serializers; do not share that client with raw SQL repositories.
  const client=globalDb.leadOrmSql??=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:10});
  return drizzle(client,{schema});
}
export type Tx = postgres.TransactionSql;
export async function closeDb() {
  if(globalDb.leadSql) { await globalDb.leadSql.end(); globalDb.leadSql=undefined; }
  if(globalDb.leadOrmSql) { await globalDb.leadOrmSql.end(); globalDb.leadOrmSql=undefined; }
}
