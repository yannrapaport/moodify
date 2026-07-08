import 'dotenv/config';
import { initDb } from './db/index.js';
import { startServer } from './server.js';

const port = parseInt(process.env.PORT ?? '3000', 10);

await initDb();
startServer(port);
