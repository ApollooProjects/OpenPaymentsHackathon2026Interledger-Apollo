import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { db } from './db.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

dotenv.config({ path: path.join(raiz, '.env'), quiet: true });

const app = express();

app.use(express.json());
app.use(express.static(path.join(raiz, 'frontend')));

app.get('/salud', (req, res) => {
    const { ok } = db.prepare('SELECT 1 AS ok').get();
    res.json({ ok: ok === 1 });
});

const puerto = Number(process.env.PORT) || 3000;

app.listen(puerto, () => {
    console.log(`La Cajita en http://localhost:${puerto}`);
});
