// Iconos SVG en vez de emojis. Los textos de las pestañas siguen usando un marcador corto (⚠, ✅, ❌, ⏳, ✔, ⚡, 🔑, 📱, 🏪)
// y aquí se cambia por un icono dibujado, igual en todos los celulares, con color y nombre para lectores de pantalla.
// Un MutationObserver lo hace con todo texto que entra a la página, así los módulos no cambian su forma de escribir textos.
(() => {
    const NS = 'http://www.w3.org/2000/svg';
    const ICONOS = {
        '✅': { clase: 'ok', nombre: 'Listo', trazos: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>' },
        '✔': { clase: 'ok', nombre: 'Listo', trazos: '<path d="M20 6 9 17l-5-5"/>' },
        '❌': { clase: 'error', nombre: 'Error', trazos: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>' },
        '⚠': { clase: 'aviso', nombre: 'Atención', trazos: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>' },
        '⏳': { clase: 'espera', nombre: 'En proceso', trazos: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>' },
        '⚡': { clase: 'rapido', trazos: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>' },
        '🔑': { clase: 'llave', trazos: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>' },
        '📱': { clase: 'neutro', trazos: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>' },
        '🏪': { clase: 'neutro', trazos: '<path d="M3 9 4.5 4h15L21 9M3 9h18M4 9v11h16V9M9 20v-6h6v6"/>' },
    };
    const MARCADOR = /(✅|✔️?|❌|⚠️?|⏳|⚡|🔑|📱|🏪)\s?/u;
    const OMITIR = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'OPTION', 'TITLE']);

    function icono(marcador) {
        const datos = ICONOS[marcador.replace('️', '')];
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('class', `icono icono-${datos.clase}`);
        svg.setAttribute('focusable', 'false');
        if (datos.nombre) {
            svg.setAttribute('role', 'img');
            svg.setAttribute('aria-label', datos.nombre);
        } else {
            svg.setAttribute('aria-hidden', 'true');
        }
        svg.innerHTML = datos.trazos;
        return svg;
    }

    function cambiarTexto(nodo) {
        if (!nodo.parentNode || OMITIR.has(nodo.parentNode.nodeName)) return;
        let texto = nodo.nodeValue;
        if (!MARCADOR.test(texto)) return;
        const partes = document.createDocumentFragment();
        let encontrado;
        while ((encontrado = MARCADOR.exec(texto))) {
            if (encontrado.index) partes.append(texto.slice(0, encontrado.index));
            partes.append(icono(encontrado[1]));
            texto = texto.slice(encontrado.index + encontrado[0].length);
        }
        if (texto) partes.append(texto);
        nodo.replaceWith(partes);
    }

    function recorrer(raiz) {
        if (raiz.nodeType === Node.TEXT_NODE) return cambiarTexto(raiz);
        if (raiz.nodeType !== Node.ELEMENT_NODE || OMITIR.has(raiz.nodeName)) return;
        const caminante = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
        const textos = [];
        while (caminante.nextNode()) textos.push(caminante.currentNode);
        textos.forEach(cambiarTexto);
    }

    recorrer(document.body);
    new MutationObserver((cambios) => {
        for (const cambio of cambios) {
            if (cambio.type === 'characterData') cambiarTexto(cambio.target);
            else cambio.addedNodes.forEach(recorrer);
        }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
