// Une los módulos de la capa 2 sin que se importen entre sí: los SMS de retiros van a la bandeja
// y el menú SMS (SALDO / RETIRAR) usa la lógica real de retiros.
import * as sms from './sms.js';
import * as retiros from './retiros.js';

retiros.usarSms(async (celular, texto) => {
    if (sms.normalizarCelular(celular)) sms.enviar(celular, texto);
    else console.warn(`[SMS sin celular válido] ${texto}`);
});

sms.usarManejadores({
    saldo: async ({ celular }) => {
        const resultado = await retiros.saldo({ celular });
        if (!resultado.ok) return 'Todavía no tienes dinero a tu nombre.';
        return `Tienes ${retiros.formatear(resultado.saldo)} disponibles. Responde RETIRAR para sacarlo en efectivo.`;
    },
    // solicitar() ya manda por SMS el PIN o el aviso de "sin saldo"; aquí solo falta el caso de quien no tiene dinero.
    retirar: async ({ celular }) => {
        const resultado = await retiros.solicitar({ celular });
        if (!resultado.ok && resultado.error === 'No hay dinero a tu nombre') return 'Todavía no tienes dinero a tu nombre.';
    }
});
