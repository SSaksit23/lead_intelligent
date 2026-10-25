import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDb,closeDb } from '../src/db';
if (process.env.MIGRATION_DATABASE_URL) process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
try{await migrate(getDb(),{migrationsFolder:'./drizzle'});console.log('Migrations complete.');}finally{await closeDb();}
