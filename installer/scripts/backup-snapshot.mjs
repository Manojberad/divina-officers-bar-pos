// Creates a transactionally consistent online snapshot of SQLite bar.db via VACUUM INTO.
import { DatabaseSync } from 'node:sqlite';

const [srcDb, destDb] = process.argv.slice(2);
if (!srcDb || !destDb) process.exit(1);

const db = new DatabaseSync(srcDb);
try {
  const escaped = destDb.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
} finally {
  db.close();
}
