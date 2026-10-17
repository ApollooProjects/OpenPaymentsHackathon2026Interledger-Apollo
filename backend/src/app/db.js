import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const carpetaDatos = path.join(raiz, 'data');

mkdirSync(carpetaDatos, { recursive: true });

export const db = new DatabaseSync(path.join(carpetaDatos, 'cajita.sqlite'));
