import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const carpetaDatos = path.join(raiz, 'data');

mkdirSync(carpetaDatos, { recursive: true });

// CAJITA_DB (opcional): otra base, p. ej. ':memory:' en las pruebas o una copia para probar sin tocar la de la demo.
export const db = new DatabaseSync(process.env.CAJITA_DB || path.join(carpetaDatos, 'cajita.sqlite'));
