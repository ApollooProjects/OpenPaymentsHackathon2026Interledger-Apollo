// Selector de perfil de la demo («Entrar como…»), sin contraseña ni backend de autenticación.
// El perfil vive en localStorage y decide qué pestañas se ven y a cuál se llega al abrir la app.
// Los enlaces con datos (#cliente?qr=…, #recibo?pago=…, #celular?numero=…) abren siempre, con o sin perfil:
// así un QR escaneado o la vuelta de la wallet funcionan en cualquier celular.
(() => {
    const wallet = (nombre) => `https://ilp.interledger-test.dev/${nombre}`;

    // Wallets de prueba de la demo (development/C0.1_WALLETS.md). Son direcciones públicas, sin llaves.
    const PERFILES = [
        { id: 'vendedora', nombre: 'Doña Rita', rol: 'Vendedora', detalle: 'Vende empanadas; una parte de cada venta salda lo que le fió su proveedor.', pestanas: ['vendedor'], wallet: wallet('vendedorapollo'), proveedor: wallet('proveedorapollo') },
        { id: 'proveedor', nombre: 'Don Julio', rol: 'Proveedor', detalle: 'Le fió la mercancía a Doña Rita y ve lo que le van pagando.', pestanas: ['cobros'], wallet: wallet('proveedorapollo') },
        { id: 'mesero1', nombre: 'Andrés', rol: 'Mesero 1', detalle: 'Recibe su parte de las propinas.', pestanas: ['cobros'], wallet: wallet('mesero1apollo') },
        { id: 'mesero2', nombre: 'Camila', rol: 'Mesera 2', detalle: 'Recibe su parte de las propinas.', pestanas: ['cobros'], wallet: wallet('mesero-2-apollo') },
        { id: 'cliente', nombre: 'Laura', rol: 'Cliente', detalle: 'Paga con QR desde su billetera.', pestanas: ['cliente', 'recibo'], wallet: wallet('cliente-a-apollo') },
        { id: 'remitente', nombre: 'Carlos', rol: 'Remitente en el exterior', detalle: 'Vive afuera y le manda dinero a su familia.', pestanas: ['remitente'], wallet: wallet('remitente-apollo') },
    ];
    const HERRAMIENTAS = ['celular', 'cajero'];

    function leerPerfil() {
        try { return PERFILES.find((p) => p.id === localStorage.getItem('cajita.perfil')) || null; } catch { return null; }
    }

    function guardarPerfil(id) {
        try { localStorage.setItem('cajita.perfil', id); } catch { /* sin almacenamiento: dura hasta recargar */ }
    }

    let perfil = leerPerfil();
    window.LaCajita = { perfil: () => perfil };

    const pestanas = document.querySelectorAll('main > section');
    const enlaces = document.querySelectorAll('header [data-pestana]');
    const saludo = document.querySelector('[data-saludo]');

    const inicio = () => (perfil ? perfil.pestanas[0] : 'perfil');

    function permitida(nombre, conDatos) {
        if (!document.getElementById(nombre)) return false;
        if (conDatos || nombre === 'perfil' || HERRAMIENTAS.includes(nombre)) return true;
        return perfil ? perfil.pestanas.includes(nombre) : false;
    }

    // Rellena lo que ya se sabe del perfil, sin pisar lo que la persona haya escrito.
    function rellenar(selector, valor) {
        const campo = document.querySelector(selector);
        if (campo && !campo.value) campo.value = valor;
    }

    function aplicarPerfil() {
        enlaces.forEach((enlace) => {
            enlace.closest('li').hidden = !perfil || !perfil.pestanas.includes(enlace.dataset.pestana);
        });
        const cobros = document.querySelector('header [data-pestana="cobros"]');
        if (cobros) cobros.textContent = perfil?.id.startsWith('mesero') ? 'Mis propinas' : 'Mis cobros';
        saludo.replaceChildren(perfil ? `Hola, ${perfil.nombre} · ` : '',
            Object.assign(document.createElement('a'), { href: '#perfil', textContent: perfil ? 'Cambiar perfil' : 'Entrar como…' }));
        if (!perfil) return;
        if (perfil.id === 'vendedora') {
            rellenar('#vendedor [name=vendedor]', perfil.nombre);
            rellenar('#vendedor [name=proveedorWallet]', perfil.proveedor);
            rellenar('#vendedor [name=walletVendedor]', perfil.wallet);
        }
        if (perfil.id === 'cliente') rellenar('#cliente [name=pagador]', perfil.wallet);
        if (perfil.id === 'remitente') {
            rellenar('#remitente [name=nombre]', perfil.nombre);
            rellenar('#remitente [name=remitente]', perfil.wallet);
        }
    }

    function mostrarPestana() {
        const [nombre, consulta = ''] = location.hash.slice(1).split('?');
        if (!permitida(nombre, Boolean(consulta))) {
            // replace: sin entrada extra en el historial; dispara hashchange y vuelve a pasar por aquí.
            location.replace(`#${inicio()}`);
            return;
        }
        pestanas.forEach((seccion) => {
            seccion.hidden = seccion.id !== nombre;
        });
        window.scrollTo(0, 0);
    }

    // Pantalla «Entrar como…»
    const lista = document.querySelector('#perfil [data-perfiles]');
    for (const p of PERFILES) {
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'secondary outline';
        boton.dataset.perfil = p.id;
        const rol = document.createElement('small');
        rol.textContent = `${p.rol} · ${p.detalle}`;
        boton.append(Object.assign(document.createElement('strong'), { textContent: p.nombre }), rol);
        boton.addEventListener('click', () => {
            perfil = p;
            guardarPerfil(p.id);
            aplicarPerfil();
            location.hash = inicio();
        });
        lista.append(boton);
    }

    // Sin pestaña en la URL se llega al inicio del perfil sin pasar por el historial (los módulos leen el hash al cargar).
    if (!location.hash.slice(1)) history.replaceState(null, '', `#${inicio()}`);
    aplicarPerfil();
    window.addEventListener('hashchange', mostrarPestana);
    mostrarPestana();
})();
