// Vincula un celular a una cédula de quien no tiene cuenta (SALDO/RETIRAR por SMS y PIN usan este vínculo).
//   node scripts/vincular-celular.js <celular> <cédula>            → vincula (falla si el celular es de otra cédula)
//   node scripts/vincular-celular.js <celular> <cédula> --forzar   → lo pasa a esa cédula aunque fuera de otra
//   node scripts/vincular-celular.js <celular> --desvincular        → deja el celular sin cédula
//   node scripts/vincular-celular.js                                → lista los vínculos
import { desvincular, listar, vincular } from '../backend/src/app/vinculos.js';

const [celular, cedula] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const forzar = process.argv.includes('--forzar');

try {
    if (celular && process.argv.includes('--desvincular')) {
        console.log(desvincular(celular) ? `Desvinculado: ${celular}` : `${celular} no tenía vínculo`);
    } else if (celular && cedula) {
        const v = vincular({ cedula, celular, forzar });
        console.log(`Vinculado: ${v.celular} → cédula ${v.cedula}`);
    }
    console.table(listar());
} catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
}
