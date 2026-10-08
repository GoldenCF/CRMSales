import { openDatabase } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const db = openDatabase();
const app = createApp(db);

app.listen(port, () => {
  console.log(`CRM running at http://localhost:${port}`);
});
