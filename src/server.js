import os from 'node:os';
import { openDatabase } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const db = openDatabase();
const app = createApp(db);

app.listen(port, host, () => {
  console.log(`CRM running at http://localhost:${port}`);
  if (host === '0.0.0.0') {
    const lan = Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => `http://${i.address}:${port}`);
    if (lan.length) console.log(`Other computers on this network can open: ${lan.join('  ')}`);
  }
});
