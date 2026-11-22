import pg from 'pg';
import { migrate } from '../persistence/pgRecorder.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
} finally {
  await pool.end();
}
