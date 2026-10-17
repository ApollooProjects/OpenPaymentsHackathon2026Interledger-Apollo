// Formularios largos de a un paso: cada [data-paso="Título"] del formulario es una pantalla, con «Paso X de N» arriba.
// El botón submit dice «Siguiente» hasta el último paso; ahí recupera su texto y el submit sigue al módulo.
// El formulario lleva novalidate: aquí se valida solo el paso visible (los campos ocultos no bloquean).
export function pasoAPaso(formulario, { total } = {}) {
    const pasos = [...formulario.querySelectorAll('[data-paso]')];
    const cuantos = total || pasos.length;
    const boton = formulario.querySelector('button[type=submit]');
    const textoFinal = boton.textContent;
    const atras = formulario.querySelector('[data-atras]');

    const cabecera = document.createElement('div');
    cabecera.className = 'progreso-pasos';
    const texto = Object.assign(document.createElement('p'), { className: 'paso-actual' });
    texto.setAttribute('aria-live', 'polite');
    const puntos = document.createElement('ol');
    puntos.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < cuantos; i += 1) puntos.append(document.createElement('li'));
    cabecera.append(texto, puntos);
    formulario.prepend(cabecera);

    let actual = 0;

    function ir(indice, { enfocar = true } = {}) {
        actual = Math.max(0, Math.min(indice, pasos.length - 1));
        pasos.forEach((paso, i) => { paso.hidden = i !== actual; });
        texto.replaceChildren(
            Object.assign(document.createElement('span'), { textContent: `Paso ${actual + 1} de ${cuantos}` }),
            Object.assign(document.createElement('strong'), { textContent: pasos[actual].dataset.paso }),
        );
        [...puntos.children].forEach((punto, i) => { punto.className = i < actual ? 'hecho' : i === actual ? 'actual' : ''; });
        boton.textContent = actual < pasos.length - 1 ? 'Siguiente' : textoFinal;
        if (atras) atras.hidden = actual === 0;
        if (enfocar) {
            cabecera.scrollIntoView({ block: 'nearest' });
            pasos[actual].querySelector('input:not([type=radio]):not([readonly]), select, textarea')?.focus({ preventScroll: true });
        }
    }

    function pasoValido() {
        const campos = pasos[actual].querySelectorAll('input, select, textarea');
        for (const campo of campos) {
            if (campo.closest('[hidden]')) continue;
            if (!campo.checkValidity()) {
                campo.reportValidity();
                return false;
            }
        }
        return true;
    }

    // Captura: corre antes que el submit del módulo y lo frena mientras no sea el último paso.
    formulario.addEventListener('submit', (evento) => {
        const valido = pasoValido();
        if (valido && actual === pasos.length - 1) return;
        evento.preventDefault();
        evento.stopImmediatePropagation();
        if (valido) ir(actual + 1);
    }, true);
    atras?.addEventListener('click', () => ir(actual - 1));

    ir(0, { enfocar: false });
    return { ir, actual: () => actual };
}
