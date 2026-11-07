/**
 * server.js – Express server para VPS
 * Sirve el frontend estático e inyecta las variables de entorno
 * a través de un endpoint /api/config (NO las expone en el HTML).
 * 
 * En el VPS:
 *   1. Crea un archivo .env con SUPABASE_URL y SUPABASE_KEY
 *   2. npm install
 *   3. node server.js   (o: pm2 start server.js --name landing)
 */
const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const dotenv     = require('dotenv');
const WebSocket  = require('ws');   // Necesario para WebSocket en Node.js < 22

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Control de Modo Prueba: Límite 2 Compras para Envíos / ENVÍA ──
const TEST_STATE_FILE = path.join(__dirname, 'test_shipping_state.json');
const MAX_TEST_ORDERS = 2;

function getTodayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getTestShippingState() {
    const today = getTodayString();
    try {
        if (fs.existsSync(TEST_STATE_FILE)) {
            const raw = fs.readFileSync(TEST_STATE_FILE, 'utf8');
            const content = JSON.parse(raw);
            if (content && content.date === today) {
                const ordersCount = Math.max(0, Number(content.ordersCount) || 0);
                const maxOrders = Number(content.maxOrders) || MAX_TEST_ORDERS;
                return {
                    date: today,
                    ordersCount,
                    maxOrders,
                    isActive: ordersCount < maxOrders
                };
            }
        }
    } catch (err) {
        console.warn('[TestShippingState] Error leyendo estado:', err.message);
    }
    return {
        date: today,
        ordersCount: 0,
        maxOrders: MAX_TEST_ORDERS,
        isActive: true
    };
}

function recordTestShippingOrderSuccess() {
    const state = getTestShippingState();
    state.ordersCount = (state.ordersCount || 0) + 1;
    state.isActive = state.ordersCount < state.maxOrders;
    try {
        fs.writeFileSync(TEST_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
        console.log(`[TestShippingState] ✅ Compra de prueba #${state.ordersCount}/${state.maxOrders} registrada. Activo: ${state.isActive}`);
    } catch (err) {
        console.error('[TestShippingState] Error guardando estado:', err.message);
    }
    return state;
}

// ── Supabase client (instancia única en el servidor) ────────────
// Se crea una vez al arrancar para evitar el error de WebSocket en Node < 22.
// Se usa auth.persistSession: false y se omite Realtime (solo necesario en browser).
const { createClient } = require('@supabase/supabase-js');
function buildSupabase(useServiceKey = false) {
    const url = process.env.SUPABASE_URL;
    const key = useServiceKey
        ? (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY)
        : (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY);
    return createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: {
            transport: WebSocket  // Fix: usa 'ws' como transporte en Node.js < 22
        }
    });
}
const supabaseAnon    = buildSupabase(false);
const supabaseService = buildSupabase(true);

// ── Middlewares ─────────────────────────────────────────────────
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});
app.use(express.json({ limit: '25mb' }));          // suficiente para base64 ~15MB
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname)));   // Sirve index.html, app.js, styles.css

// ── /api/config ─────────────────────────────────────────────────
// El frontend llama a este endpoint para obtener las credenciales.
// Solo devuelve la anon key (diseñada para ser pública con RLS).
// NUNCA pongas la service_role key aquí.
app.get('/api/config', (req, res) => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

    if (!url || !key) {
        return res.status(500).json({ error: 'Supabase credentials not configured in .env' });
    }

    const testState = getTestShippingState();

    // No cachear /api/config de forma fija para reflejar el estado del modo prueba
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({ 
        SUPABASE_URL: url, 
        SUPABASE_KEY: key,
        TENANT_ID: process.env.TENANT_ID || 'b33b6851-f016-41f0-9000-91dc234df499',
        SHIPPING_TEST_ACTIVE: testState.isActive,
        SHIPPING_TEST_ORDERS_COUNT: testState.ordersCount,
        SHIPPING_TEST_MAX_ORDERS: testState.maxOrders
    });
});

// ── Endpoints de control de Modo Prueba ──────────────────────────
app.get('/api/shipping-test-state', (req, res) => {
    res.json(getTestShippingState());
});

app.post('/api/shipping-test-state/reset', (req, res) => {
    const state = {
        date: getTodayString(),
        ordersCount: 0,
        maxOrders: MAX_TEST_ORDERS,
        isActive: true
    };
    try {
        fs.writeFileSync(TEST_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
        console.log('[TestShippingState] Contador reiniciado a 0.');
    } catch (e) {
        console.error('Error al reiniciar test state:', e.message);
    }
    res.json({ status: 'success', state });
});

// ── /api/zapatos ────────────────────────────────────────────────
// Proxy cacheado: el servidor trae todos los zapatos de Supabase (server-to-server
// es mucho más rápido que browser-to-Supabase), los cachea 5 min en memoria y los
// devuelve al cliente en una sola respuesta. Las recargas dentro de esos 5 min
// son instantáneas al no tocar Supabase.
const CAMPOS = 'id,modelo,modelo_interno,identificador_interno,marca,color,foto_url,precio_venta,cantidad,cantidad_reservada,talla,categoria,tenant_id';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos
let zapatosCache = { data: null, ts: 0 };

// Función interna: trae una página de zapatos
function fetchPage(offset, limit = 1000) {
    const tenantId = process.env.TENANT_ID || 'b33b6851-f016-41f0-9000-91dc234df499';
    return supabaseAnon
        .from('zapatos')
        .select(CAMPOS)
        .eq('tenant_id', tenantId)
        .range(offset, offset + limit - 1)
        .then(({ data, error }) => {
            if (error) throw new Error(error.message);
            return data || [];
        });
}

app.get('/api/zapatos', async (req, res) => {
    const now = Date.now();

    // Devolver caché si aún es válido
    if (zapatosCache.data && (now - zapatosCache.ts) < CACHE_TTL) {
        res.set('Cache-Control', 'public, max-age=60');
        res.set('X-Cache', 'HIT');
        return res.json(zapatosCache.data);
    }

    try {
        // 1ª página siempre se pide (necesitamos saber cuántos hay)
        const first = await fetchPage(0);

        let allData = [...first];

        // Si vino llena (1000), lanzamos el resto en PARALELO
        if (first.length === 1000) {
            // Pedimos hasta 5 páginas más en paralelo (cubre hasta 6000 registros)
            const extras = await Promise.all([
                fetchPage(1000),
                fetchPage(2000),
                fetchPage(3000),
                fetchPage(4000),
                fetchPage(5000)
            ]);
            for (const page of extras) {
                allData = allData.concat(page);
                if (page.length < 1000) break; // última página
            }
        }

        zapatosCache = { data: allData, ts: now };
        console.log(`[caché] Zapatos actualizados: ${allData.length} registros`);

        res.set('Cache-Control', 'public, max-age=60');
        res.set('X-Cache', 'MISS');
        res.json(allData);
    } catch (err) {
        console.error('[/api/zapatos]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Invalidar caché manualmente (llamar con POST /api/zapatos/refresh)
app.post('/api/zapatos/refresh', (req, res) => {
    zapatosCache = { data: null, ts: 0 };
    console.log('[caché] Zapatos invalidados manualmente');
    res.json({ ok: true, message: 'Caché invalidado. La siguiente carga traerá datos frescos.' });
});

// ── /api/recientes ────────────────────────────────────────────────
// Obtiene los zapatos recién actualizados desde historial_mensajes.
// El bot de línea 1 envía mensajes como:
//   [Supreme]: *Nike Mercurial Vapor Superfly 1 RGN SE CR7, $ 140.000 Eur 40 41 42 43 44 R 5252*
// donde "R 5252" es el identificador_interno del zapato.
// Este endpoint devuelve los últimos 20 zapatos únicos encontrados.
const RECIENTES_CACHE_TTL = 2 * 60 * 1000; // 2 minutos
let recientesCache = { data: null, ts: 0 };

app.get('/api/recientes', async (req, res) => {
    const now = Date.now();
    if (recientesCache.data && (now - recientesCache.ts) < RECIENTES_CACHE_TTL) {
        res.set('Cache-Control', 'public, max-age=60');
        return res.json(recientesCache.data);
    }

    try {
        const TENANT_ID = process.env.TENANT_ID || 'b33b6851-f016-41f0-9000-91dc234df499';

                const BOT_ID = process.env.BOT_ID || 'linea2';

        // Intentar obtener difusiones del bot correspondiente
        let ordered = [];
        const { data: mensajes, error: msgErr } = await supabaseAnon
            .from('historial_mensajes')
            .select('mensaje, created_at')
            .eq('bot_id', BOT_ID)
            .order('created_at', { ascending: false })
            .limit(50);

        if (!msgErr && mensajes && mensajes.length > 0) {
            const idsSet = new Set();
            const idsOrder = [];
            mensajes.forEach(msg => {
                const match = msg.mensaje.match(/\bR\s+(\d{3,5})\b/);
                if (match) {
                    const id = match[1];
                    if (!idsSet.has(id)) {
                        idsSet.add(id);
                        idsOrder.push(id);
                    }
                }
            });

            if (idsOrder.length > 0) {
                const topIds = idsOrder.slice(0, 20);
                const { data: zapatos, error: zapErr } = await supabaseAnon
                    .from('zapatos')
                    .select(CAMPOS)
                    .in('identificador_interno', topIds)
                    .eq('tenant_id', TENANT_ID);

                if (!zapErr && zapatos && zapatos.length > 0) {
                    ordered = topIds.flatMap(id => (zapatos || []).filter(z => z.identificador_interno === id));
                }
            }
        }

        // Si no hay difusiones recientes con identificador para este bot,
        // devolvemos los últimos productos registrados del tenant
        if (ordered.length === 0) {
            const { data: ultimos, error: ultErr } = await supabaseAnon
                .from('zapatos')
                .select(CAMPOS)
                .eq('tenant_id', TENANT_ID)
                .gt('cantidad', 0)
                .order('created_at', { ascending: false })
                .limit(20);

            if (!ultErr && ultimos) {
                ordered = ultimos;
            }
        }

        recientesCache = { data: ordered, ts: now };
        res.set('Cache-Control', 'public, max-age=60');
        res.json(ordered);

    } catch (err) {
        console.error('[/api/recientes]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── MiPaquete.com API v2 Integration Helper ──────────────────────
const https = require('https');
const crypto = require('crypto');

const MIPAQUETE_API_KEY = process.env.MIPAQUETE_API_KEY || "";

let dynamicDaneMap = {
    'bogota': '11001000', 'medellin': '05001000', 'cali': '76001000',
    'barranquilla': '08001000', 'cartagena': '13001000', 'ibague': '73001000'
};

function loadLocationsFromMiPaquete() {
    return new Promise((resolve) => {
        const u = new URL('https://api-v2.mpr.mipaquete.com/getLocations');
        const req = https.request(u, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'session-tracker': crypto.randomUUID(),
                'apikey': MIPAQUETE_API_KEY
            }
        }, (res) => {
            let d = '';
            res.on('data', chunk => d += chunk);
            res.on('end', () => {
                try {
                    const list = JSON.parse(d);
                    if (Array.isArray(list)) {
                        list.forEach(loc => {
                            if (loc.locationName && loc.locationCode) {
                                const norm = loc.locationName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                                dynamicDaneMap[norm] = loc.locationCode;
                            }
                        });
                        console.log(`[MiPaquete API] Cargadas exitosamente ${Object.keys(dynamicDaneMap).length} ciudades de Colombia dinámicamente.`);
                    }
                } catch(e) {}
                resolve(dynamicDaneMap);
            });
        });
        req.on('error', () => resolve(dynamicDaneMap));
        req.end();
    });
}

// Cargar ciudades dinámicamente al arrancar el servidor
loadLocationsFromMiPaquete();

function resolveDaneCode(cityStr) {
    if (!cityStr) return '11001000';
    const norm = cityStr.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (dynamicDaneMap[norm]) return dynamicDaneMap[norm];

    for (const [key, code] of Object.entries(dynamicDaneMap)) {
        if (norm === key || key.startsWith(norm) || norm.startsWith(key)) {
            return code;
        }
    }
    return '11001000';
}



function callMiPaqueteAPI(endpoint, bodyData, sessionTracker, method = 'POST') {
    const uuid = sessionTracker || crypto.randomUUID();
    return new Promise((resolve) => {
        const u = new URL(`https://api-v2.mpr.mipaquete.com${endpoint}`);
        const req = https.request(u, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'session-tracker': uuid,
                'apikey': MIPAQUETE_API_KEY
            }
        }, (res) => {
            let dataStr = '';
            res.on('data', chunk => dataStr += chunk);
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(dataStr); } catch(e){}
                resolve({ status: res.statusCode, data: parsed || dataStr });
            });
        });
        req.on('error', (err) => resolve({ error: err.message }));
        if (bodyData && (method === 'POST' || method === 'PUT')) req.write(JSON.stringify(bodyData));
        req.end();
    });
}

// ── Consultar Estado & Guía Oficial de Transportadora en MiPaquete ──
async function fetchMiPaqueteTracking(mpCode, maxAttempts = 3, delayMs = 1200) {
    if (!mpCode) return null;
    const cleanMp = String(mpCode).replace(/\D/g, '');
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await callMiPaqueteAPI(`/getSendingTracking?mpCode=${cleanMp}`, null, null, 'GET');
            if (res.status === 200 && res.data && res.data.guideNumber) {
                return res.data;
            }
        } catch (e) {
            console.error(`[MiPaquete API] Intento ${attempt} consultando tracking error:`, e.message);
        }
        if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    return null;
}

// ── Reglas de Paquetería y Dimensiones ─────────────────────────────
// Paquete 1: 1 zapato      → 30×20×12 cm, 1.0 kg (ENVÍA ~$18.800)
// Paquete 2: 2 a 3 zapatos → 35×25×20 cm, 2.5 kg (ENVÍA ~$23.900)
// Paquete 3: 4 a 5 zapatos → 40×30×25 cm, 4.5 kg (ENVÍA ~$31.300)
// Paquete 4: 6 a 8 zapatos → 45×35×30 cm, 8.0 kg (COORD ~$40.580 / $59.930)
// Paquete 5: 9 a 11 zapatos → 50×40×35 cm, 11.0 kg (COORD ~$40.580 / $59.930)
// Más de 11 zapatos (> 11)  → Alerta manual a BoxApp / Requiere cotización manual de personal
function getPackageSpecs(numShoes) {
    const qty = Math.max(1, Number(numShoes) || 1);
    if (qty === 1) {
        return { nivel: 'Paquete 1', largo: 30, ancho: 20, alto: 12, peso: 1.0, requiresManualQuote: false };
    } else if (qty >= 2 && qty <= 3) {
        return { nivel: 'Paquete 2', largo: 35, ancho: 25, alto: 20, peso: 2.5, requiresManualQuote: false };
    } else if (qty >= 4 && qty <= 5) {
        return { nivel: 'Paquete 3', largo: 40, ancho: 30, alto: 25, peso: 4.5, requiresManualQuote: false };
    } else if (qty >= 6 && qty <= 8) {
        return { nivel: 'Paquete 4', largo: 45, ancho: 35, alto: 30, peso: 8.0, requiresManualQuote: false };
    } else if (qty >= 9 && qty <= 11) {
        return { nivel: 'Paquete 5', largo: 50, ancho: 40, alto: 35, peso: 11.0, requiresManualQuote: false };
    } else {
        return { nivel: 'Especial (> 11 pares)', largo: 60, ancho: 50, alto: 45, peso: qty * 1.0, requiresManualQuote: true };
    }
}

// ── /api/cotizar-envio ───────────────────────────────────────────
// Cotiza el envío con MiPaquete v2 en tiempo real optimizado según matriz de empaque
app.post('/api/cotizar-envio', async (req, res) => {
    const { ciudad, valorDeclarado, peso, cantidad } = req.body;
    try {
        const testState = getTestShippingState();
        if (!testState.isActive) {
            return res.json({
                status: 'disabled',
                enabled: false,
                message: 'Cotización de envíos inactiva (límite de compras de prueba alcanzado).'
            });
        }

        const numCantidad = Math.max(1, Number(cantidad) || 1);
        const pkg = getPackageSpecs(numCantidad);

        // 🚨 Si son más de 11 pares, requiere cotización de envío manual por personal
        if (pkg.requiresManualQuote) {
            return res.json({
                status: 'manual_quote_required',
                requiresManualQuote: true,
                message: `El pedido contiene ${numCantidad} pares (> 11 pares). Requiere cotización de envío manual por parte de nuestro personal.`,
                selectedCarrier: {
                    id: 'manual-quote',
                    deliveryCompanyId: null,
                    name: 'COTIZACIÓN MANUAL (+11 PARES)',
                    cost: 0,
                    shippingTime: null,
                    isManual: true
                },
                cheapestCarrier: {
                    id: 'manual-quote',
                    deliveryCompanyId: null,
                    name: 'COTIZACIÓN MANUAL (+11 PARES)',
                    cost: 0,
                    shippingTime: null,
                    isManual: true
                },
                paqueteNivel: pkg.nivel
            });
        }

        const destinyCode = resolveDaneCode(ciudad);
        const originCode = process.env.ORIGIN_DANE_CODE || '76001000'; // CALI por defecto
        const sessionTracker = crypto.randomUUID();

        const largo = pkg.largo;
        const ancho = pkg.ancho;
        const alto = pkg.alto;
        const pesoCalculado = pkg.peso;
        const valorCalc = Math.min(250000, numCantidad * 50000);

        const quoteResult = await callMiPaqueteAPI('/quoteShipping', {
            originLocationCode: originCode,
            destinyLocationCode: destinyCode,
            quantity: 1, // 1 paquete consolidado
            width: ancho,
            length: largo,
            height: alto,
            weight: pesoCalculado,
            declaredValue: valorCalc
        }, sessionTracker);

        let carriers = [];
        let selectedCarrier = null;

        if (quoteResult.status === 200 && Array.isArray(quoteResult.data) && quoteResult.data.length > 0) {
            // Ordenar opciones de la API de menor a mayor costo real
            const sortedData = quoteResult.data.sort((a, b) => (a.shippingCost || 0) - (b.shippingCost || 0));

            carriers = sortedData.map(c => ({
                id: c.id,
                deliveryCompanyId: c.deliveryCompanyId,
                name: c.deliveryCompanyName,
                imgUrl: c.deliveryCompanyImgUrl,
                cost: c.shippingCost, // VALOR REAL DEVUELTO POR LA API DE MIPAQUETE
                shippingTime: c.shippingTime,
                pickupService: c.pickupService
            }));

            // Seleccionar la transportadora REAL más económica devuelta por MiPaquete
            selectedCarrier = carriers[0];
        }

        if (!selectedCarrier) {
            let fleteFallback = 18800;
            if (numCantidad >= 2 && numCantidad <= 3) fleteFallback = 23900;
            else if (numCantidad >= 4 && numCantidad <= 5) fleteFallback = 31300;
            else if (numCantidad >= 6 && numCantidad <= 8) fleteFallback = 40580;
            else if (numCantidad >= 9 && numCantidad <= 11) fleteFallback = 40580;

            selectedCarrier = {
                id: 'fallback-envia',
                deliveryCompanyId: '6080a75ef08a770ddd9724fd',
                name: 'ENVÍA',
                cost: fleteFallback,
                shippingTime: 2880
            };
        }

        return res.json({
            status: 'success',
            destinyCode,
            sessionTracker,
            carriers,
            selectedCarrier,
            cheapestCarrier: selectedCarrier,
            paqueteNivel: pkg.nivel,
            requiresManualQuote: false
        });

    } catch (err) {
        console.error('[/api/cotizar-envio] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});


// ── /api/crear-orden ─────────────────────────────────────────────
// Crea la orden completa (reserva inventario, venta, pedido, impresión)
// usando el backend del bot (db.ts compilado) o directamente con supabase-js.
app.post('/api/crear-orden', async (req, res) => {

    const { telefono, items, datosEnvio } = req.body;
    if (!telefono || !items || !datosEnvio) {
        return res.status(400).json({ status: 'error', message: 'Datos incompletos.' });
    }

    try {
        // Usamos la instancia global (service key) creada al arrancar sin WebSocket
        const supabase = supabaseService;

        const VENDEDOR_ID = process.env.ADMIN_USER_ID || 'e8ac631d-1f80-4fad-ae6c-327825e7a78a';
        const LOCAL_ID    = process.env.LOCAL_ID || '8a2e0ecd-3d7a-4233-94d8-c5b5ae046242';
        const TENANT_ID   = process.env.TENANT_ID || 'b33b6851-f016-41f0-9000-91dc234df499';

        // ── 1. Buscar o crear comprador ──────────────────────────────
        let { data: comprador } = await supabase
            .from('compradores')
            .select('id')
            .eq('numero_documento', datosEnvio.cedula)
            .maybeSingle();

        if (!comprador) {
            // Si no existe por documento, buscar por teléfono por si acaso
            const { data: compTel } = await supabase
                .from('compradores')
                .select('id')
                .eq('telefono', datosEnvio.telefono)
                .maybeSingle();
                
            if (compTel) {
                comprador = compTel;
            }
        }

        if (!comprador) {
            const { data: newComp, error: newCompErr } = await supabase
                .from('compradores')
                .insert([{
                    telefono: datosEnvio.telefono,
                    nombre: datosEnvio.nombreCliente,
                    numero_documento: datosEnvio.cedula,
                    direccion: `${datosEnvio.direccion}, ${datosEnvio.ciudad}`,
                    tenant_id: TENANT_ID
                }])
                .select()
                .single();
            if (newCompErr) {
                console.error('Error insertando comprador:', newCompErr);
                throw new Error('Error creando comprador: ' + newCompErr.message);
            }
            comprador = newComp;
        } else {
            // Actualizar datos del comprador existente
            await supabase.from('compradores')
                .update({ 
                    telefono: datosEnvio.telefono, 
                    direccion: `${datosEnvio.direccion}, ${datosEnvio.ciudad}`,
                    nombre: datosEnvio.nombreCliente
                })
                .eq('id', comprador.id);
        }

        // ── 2. Validar stock y calcular total ────────────────────────
        let totalVenta = 0;
        const detallesParaInsertar = [];
        const zapatosParaActualizar = [];

        for (const item of items) {
            let zapato = null;

            // ── Búsqueda EXACTA por zapato_id (enviado desde el carrito) ────
            // Esto evita que un zapato con el mismo nombre pero diferente
            // identificador_interno (referencia) sea reservado por error.
            if (item.zapato_id) {
                const { data: byId, error: byIdErr } = await supabase
                    .from('zapatos')
                    .select('id, precio_venta, cantidad, cantidad_reservada, modelo, talla, identificador_interno')
                    .eq('id', item.zapato_id)
                    .gt('cantidad', 0)
                    .maybeSingle();

                if (!byIdErr && byId && byId.talla == item.talla) {
                    zapato = byId;
                }
            }

            // ── Fallback: busca por modelo + talla (solo si no llegó zapato_id) ─
            if (!zapato) {
                const { data: zapatosList, error: zapErr } = await supabase
                    .from('zapatos')
                    .select('id, precio_venta, cantidad, cantidad_reservada, modelo, talla, identificador_interno')
                    .ilike('modelo', `%${item.modelo}%`)
                    .eq('talla', item.talla)
                    .gt('cantidad', 0);

                if (zapErr || !zapatosList || zapatosList.length === 0) {
                    throw new Error(`No hay stock disponible para ${item.modelo} talla EU ${item.talla}`);
                }

                zapato = zapatosList.find(z =>
                    (z.cantidad || 0) - (z.cantidad_reservada || 0) >= item.cantidad
                );
            }

            if (!zapato) {
                throw new Error(`Stock insuficiente para ${item.modelo} talla EU ${item.talla}. El zapato ya fue reservado por otro cliente.`);
            }

            // Validar stock disponible
            const disponible = (zapato.cantidad || 0) - (zapato.cantidad_reservada || 0);
            if (disponible < item.cantidad) {
                throw new Error(`Stock insuficiente para ${item.modelo} talla EU ${item.talla}. Solo quedan ${disponible} unidades.`);
            }

            const subtotal = (zapato.precio_venta || 0) * item.cantidad;
            totalVenta += subtotal;

            detallesParaInsertar.push({
                zapato_id: zapato.id,
                modelo: zapato.modelo,
                talla: zapato.talla,
                cantidad: item.cantidad,
                precio_unitario: zapato.precio_venta,
                subtotal,
                tenant_id: TENANT_ID
            });

            zapatosParaActualizar.push({
                id: zapato.id,
                nuevaCantidad: (zapato.cantidad || 0), // ¡No se resta la cantidad física en la reserva!
                nuevaCantidadReservada: (zapato.cantidad_reservada || 0) + item.cantidad,
                oldCantidad: zapato.cantidad || 0,
                cantidadComprada: item.cantidad
            });
        }

        // ── 3. Crear Venta ───────────────────────────────────────────
        const numeroVenta = `V-WEB-${Date.now()}`;
        let observacionesStr = `Compra WEB | Pago pendiente | ${datosEnvio.direccion}, ${datosEnvio.ciudad}`;
        if (datosEnvio.datosRemitente) {
            observacionesStr += ` | REMITENTE: ${JSON.stringify(datosEnvio.datosRemitente)}`;
        }

        const { data: venta, error: vntErr } = await supabase
            .from('ventas')
            .insert([{
                numero_venta: numeroVenta,
                total: totalVenta,
                vendedor_id: VENDEDOR_ID,
                comprador_id: comprador.id,
                local_id: LOCAL_ID,
                comprador_nombre: datosEnvio.nombreCliente,
                comprador_numero_documento: datosEnvio.cedula,
                comprador_telefono: datosEnvio.telefono,
                comprador_direccion: `${datosEnvio.direccion}, ${datosEnvio.ciudad}`,
                observaciones: observacionesStr,
                tenant_id: TENANT_ID
            }])
            .select()
            .single();

        if (vntErr) throw new Error('Error creando venta: ' + vntErr.message);

        // ── 4. Detalles de venta ─────────────────────────────────────
        const detallesFinales = detallesParaInsertar.map(d => ({ ...d, venta_id: venta.id }));
        const { error: detErr } = await supabase.from('detalle_ventas').insert(detallesFinales);
        if (detErr) throw new Error('Error insertando detalles: ' + detErr.message);

        // ── 5. (Factura eliminada) La BD crea la factura (FV-XXXXXX) automáticamente mediante triggers ──

        // ── 6. Crear Pedido y Generar Guía con MiPaquete (solo en Modo Prueba < 2 compras) ──
        const testState = getTestShippingState();
        let numeroGuia = '';
        let transportadora = null;
        let valorEnvio = 0;
        let guiaTransportadora = '';
        let urlGuia = '';
        let mpCode = '';
        let cobroContraentrega = false;

        const numItems = items.reduce((a, b) => a + (Number(b.cantidad) || 1), 0) || 1;
        const pkgSpecs = getPackageSpecs(numItems);

        if (pkgSpecs.requiresManualQuote) {
            // Para más de 11 pares, no se genera envío automático en MiPaquete: requiere cotización de personal
            transportadora = 'COTIZACIÓN MANUAL (PERSONAL)';
            valorEnvio = 0;
            cobroContraentrega = false;
            console.log(`[API /crear-orden] Pedido de ${numItems} pares (> 11 pares). Requiere cotización de envío manual por personal.`);
        } else if (testState.isActive) {
            // Solo se genera envío en MiPaquete si estamos dentro de las compras de prueba
            cobroContraentrega = true;

            try {
                const destinyCode = resolveDaneCode(datosEnvio.ciudad);
                const originCode = process.env.ORIGIN_DANE_CODE || '76001000'; // CALI
                const sessionTracker = crypto.randomUUID();
                const valorDeclarado = Math.min(250000, numItems * 50000);

                // Paso 1: Cotizar de forma sincrónica e inmediata con MiPaquete para registrar el session-tracker
                console.log(`[API /crear-orden] Cotizando fresh con MiPaquete para sesión ${sessionTracker}...`);
                const quoteRes = await callMiPaqueteAPI('/quoteShipping', {
                    originLocationCode: originCode,
                    destinyLocationCode: destinyCode,
                    quantity: 1, // 1 paquete consolidado
                    width: pkgSpecs.ancho,
                    length: pkgSpecs.largo,
                    height: pkgSpecs.alto,
                    weight: pkgSpecs.peso,
                    declaredValue: valorDeclarado
                }, sessionTracker);

                let selectedCarrier = null;
                if (quoteRes.status === 200 && Array.isArray(quoteRes.data) && quoteRes.data.length > 0) {
                    const sortedCarriers = quoteRes.data.sort((a, b) => (a.shippingCost || 0) - (b.shippingCost || 0));
                    // Si el cliente prefirió una transportadora y está en las cotizadas, usarla; si no, la más económica
                    if (datosEnvio.transportadoraId) {
                        selectedCarrier = sortedCarriers.find(c => c.deliveryCompanyId === datosEnvio.transportadoraId || c.id === datosEnvio.transportadoraId);
                    }
                    if (!selectedCarrier) {
                        selectedCarrier = sortedCarriers[0];
                    }
                }

                const deliveryCompanyId = selectedCarrier ? (selectedCarrier.deliveryCompanyId || selectedCarrier.id) : (datosEnvio.transportadoraId || "6080a75ef08a770ddd9724fd");
                transportadora = selectedCarrier ? selectedCarrier.deliveryCompanyName : (datosEnvio.transportadoraNombre || 'ENVÍA');
                valorEnvio = selectedCarrier ? (selectedCarrier.shippingCost || 18800) : (Number(datosEnvio.valorEnvio) || 18800);

                const senderObj = datosEnvio.datosRemitente ? {
                    name: (datosEnvio.datosRemitente.nombre || "DAYANA VERGARA").toUpperCase(),
                    surname: "PREMIER",
                    email: "premierservice2022@gmail.com",
                    cellPhone: datosEnvio.datosRemitente.telefono || "3116353464",
                    prefix: "57",
                    pickupAddress: datosEnvio.datosRemitente.direccion || "Calle 14 #6-34 CC Mio Local 07",
                    nit: "1060799100",
                    nitType: "CC"
                } : {
                    name: "DAYANA",
                    surname: "VERGARA",
                    email: "premierservice2022@gmail.com",
                    cellPhone: "3116353464",
                    prefix: "57",
                    pickupAddress: "Calle 14 #6-34 CC Mio Local 07",
                    nit: "1060799100",
                    nitType: "CC"
                };

                const nameParts = (datosEnvio.nombreCliente || "CLIENTE").trim().split(' ');
                const firstName = nameParts[0] || "CLIENTE";
                const lastName = nameParts.slice(1).join(' ') || "COMPRADOR";

                const sendingPayload = {
                    channel: "API",
                    paymentType: 101, // Contraentrega flete
                    requestPickup: true, // Recogida en local (no llevar a sucursal)
                    adminTransactionData: { saleValue: Math.max(10000, Number(totalVenta) || 50000) },
                    locate: {
                        originDaneCode: originCode,
                        destinyDaneCode: destinyCode
                    },
                    description: "CALZADO ZAPATOS",
                    sender: senderObj,
                    receiver: {
                        name: firstName,
                        surname: lastName,
                        email: datosEnvio.email || "cliente@tienda.com",
                        cellPhone: datosEnvio.telefono,
                        prefix: "57",
                        destinationAddress: `${datosEnvio.direccion}, ${datosEnvio.ciudad}`,
                        nit: datosEnvio.cedula || "123456789",
                        nitType: "CC"
                    },
                    productInformation: {
                        quantity: 1, // Consolidado en 1 paquete como en la cotización
                        width: pkgSpecs.ancho,
                        large: pkgSpecs.largo,
                        height: pkgSpecs.alto,
                        weight: pkgSpecs.peso,
                        declaredValue: valorDeclarado,
                        forbiddenProduct: false,
                        productReference: numeroVenta
                    },
                    deliveryCompany: deliveryCompanyId
                };

                console.log(`[API /crear-orden] Enviando createSending a MiPaquete con transportadora ${transportadora} (${deliveryCompanyId})...`);
                const mpRes = await callMiPaqueteAPI('/createSending', sendingPayload, sessionTracker);
                console.log('[API /crear-orden] MiPaquete createSending status:', mpRes.status, 'data:', JSON.stringify(mpRes.data));

                if (mpRes.status === 200 && mpRes.data && (mpRes.data.mpCode || mpRes.data.id)) {
                    mpCode = String(mpRes.data.mpCode || mpRes.data.id || '');
                    if (mpRes.data.deliveryCompanyName) transportadora = mpRes.data.deliveryCompanyName;
                    if (mpRes.data.shippingCost) valorEnvio = mpRes.data.shippingCost;

                    // Consultar inmediatamente el número oficial de guía de la transportadora (ENVÍA, etc.)
                    console.log(`[API /crear-orden] Consultando número de guía oficial de la transportadora para MP ${mpCode}...`);
                    const trackingData = await fetchMiPaqueteTracking(mpCode, 3, 1000);
                    if (trackingData && trackingData.guideNumber) {
                        guiaTransportadora = String(trackingData.guideNumber);
                        if (trackingData.deliveryCompanyName) transportadora = trackingData.deliveryCompanyName;
                        console.log(`[API /crear-orden] ✅ Guía oficial de la transportadora obtenida: ${guiaTransportadora} (${transportadora})`);
                    } else {
                        guiaTransportadora = mpRes.data.guideNumber ? String(mpRes.data.guideNumber) : (mpCode ? ('MP' + mpCode) : '');
                    }

                    urlGuia = mpRes.data.url || mpRes.data.pdfUrl || mpRes.data.trackingUrl || '';
                    console.log(`[API /crear-orden] ✅ Envío MiPaquete registrado con éxito. MP Code: ${mpCode}, Guía Transp: ${guiaTransportadora}`);

                    // Únicamente si MiPaquete generó el envío con éxito se incrementa el contador de pruebas
                    recordTestShippingOrderSuccess();
                } else {
                    console.error(`[API /crear-orden] ❌ No se pudo crear el envío en MiPaquete (status ${mpRes.status}). No se incrementa contador de pruebas.`);
                    guiaTransportadora = '';
                    urlGuia = '';
                    mpCode = '';
                }
            } catch (mpErr) {
                console.error('[API /crear-orden] ❌ Error en MiPaquete API:', mpErr.message);
            }
        } else {
            console.log(`[API /crear-orden] Modo prueba inactivo o límite alcanzado (${testState.ordersCount}/${testState.maxOrders}). Orden creada en modo estándar.`);
        }

        console.log('[API] PASO 6: Buscando o creando pedido para venta:', venta.id);
        const { data: pedidoExistente } = await supabase
            .from('pedidos')
            .select('id')
            .eq('venta_id', venta.id)
            .maybeSingle();

        let targetPedidoId = pedidoExistente ? pedidoExistente.id : null;

        if (!targetPedidoId) {
            const { data: pedData, error: pedErr } = await supabase.from('pedidos').insert([{
                venta_id: venta.id,
                estado: 'pendiente',
                tenant_id: TENANT_ID
            }]).select('id').single();
            if (!pedErr && pedData) targetPedidoId = pedData.id;
        }

        if (targetPedidoId) {
            const defaultTrackingMsg = pkgSpecs.requiresManualQuote 
                ? `Pedido de ${numItems} pares (> 11 pares). Requiere cotización de envío manual por personal.` 
                : (guiaTransportadora && !guiaTransportadora.startsWith('MP') 
                    ? `Enviado por ${transportadora || 'ENVIA'} #${guiaTransportadora}` 
                    : null);

            const { data: newGuia, error: newGuiaError } = await supabase
                .from('guias')
                .insert({ 
                    pedido_id: targetPedidoId,
                    venta_id: venta.id,
                    tenant_id: TENANT_ID,
                    transportadora: transportadora || null,
                    valor_envio: valorEnvio || 0,
                    guia_transportadora: guiaTransportadora || null,
                    url_guia: urlGuia || null,
                    cobro_contraentrega_envio: cobroContraentrega,
                    mp_code: mpCode || null,
                    mensaje: defaultTrackingMsg
                })
                .select('numero_guia, transportadora, guia_transportadora, valor_envio, url_guia')
                .single();

            if (!newGuiaError && newGuia) {
                numeroGuia = 'GUIA-' + String(newGuia.numero_guia).padStart(6, '0');
                if (newGuia.guia_transportadora) {
                    guiaTransportadora = newGuia.guia_transportadora;
                }
                console.log('[API] Guía registrada con éxito:', numeroGuia, '| Transportadora:', transportadora, '| Guía Transp:', guiaTransportadora || numeroGuia);
            } else {
                console.error('[API] Error creando guía en BD:', newGuiaError?.message);
            }
        }


        // ── 7. Cola de Impresión ─────────────────────────────────────
        await supabase.from('cola_impresion').insert([{
            tenant_id: TENANT_ID,
            referencia_id: venta.id,
            tipo: 'venta',
            data: { venta_id: venta.id },
            estado: 'pendiente'
        }]);

        // ── 8. Descontar inventario con control de concurrencia optimista ──
        for (const z of zapatosParaActualizar) {
            const { data: updated, error: updErr } = await supabase
                .from('zapatos')
                .update({ cantidad: z.nuevaCantidad, cantidad_reservada: z.nuevaCantidadReservada })
                .eq('id', z.id)
                .eq('cantidad', z.oldCantidad)  // Optimistic locking
                .select('id');

            if (updErr || !updated || updated.length === 0) {
                throw new Error(`Error de concurrencia: el stock cambió mientras procesábamos tu orden. Intenta nuevamente.`);
            }

            // Movimiento de inventario (registro de la reserva/venta)
            await supabase.from('movimientos_inventario').insert([{
                tipo: 'reserva_web',
                producto_tipo: 'zapato',
                producto_id: z.id,
                cantidad: -z.cantidadComprada, 
                descripcion: `Reserva WEB ${numeroVenta}`,
                usuario_id: VENDEDOR_ID,
                tenant_id: TENANT_ID
            }]);
        }

        // ── 9. Alerta de escalamiento ────────────────────────────────
        const alertMsg = pkgSpecs.requiresManualQuote 
            ? `🚨 PEDIDO MAYOR A 11 PARES (${numItems} pares) en Venta ${numeroVenta} - REQUIERE COTIZACIÓN DE ENVÍO MANUAL POR PARTE DE PERSONAL. Cliente: ${datosEnvio.nombreCliente} (${datosEnvio.telefono}, ${datosEnvio.ciudad})`
            : `Orden WEB creada: ${numeroVenta} - Esperando comprobante Nequi`;

        const alertMotivo = pkgSpecs.requiresManualQuote
            ? 'Cotización envío manual (+11 pares)'
            : 'Pago pendiente Nequi web';

        await supabase.from('alertas_escalamiento').insert([{
            telefono: datosEnvio.telefono,
            mensaje_usuario: alertMsg,
            motivo: alertMotivo
        }]);

        const currentTestState = getTestShippingState();
        return res.json({ 
            status: 'success', 
            ventaId: venta.id, 
            numeroVenta, 
            total: totalVenta, 
            numeroGuia, 
            requiresManualQuote: pkgSpecs.requiresManualQuote,
            shippingTestActive: currentTestState.isActive,
            shippingTestOrdersCount: currentTestState.ordersCount
        });

    } catch (err) {
        console.error('[API /crear-orden] Error:', err.message);
        return res.status(400).json({ status: 'error', message: err.message });
    }
});

// ── /api/upload-comprobante ─────────────────────────────────────
// Recibe el archivo como base64 en JSON (más compatible con iOS Safari /
// Chrome mobile que multipart/form-data). El servidor sube a Supabase Storage
// y devuelve la URL pública.
app.post('/api/upload-comprobante', async (req, res) => {
    const { venta_id, fileData, fileName, mimeType } = req.body;

    if (!fileData) {
        return res.status(400).json({ status: 'error', message: 'No se recibió ningún archivo' });
    }

    try {
        const supabase = supabaseService;

        // Decodificar base64 → Buffer
        const base64 = fileData.replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');

        const ext    = (fileName || 'foto.jpg').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const safeId = (venta_id || 'x').replace(/[^a-zA-Z0-9_-]/g, '');
        const storageName = `comprobante_${safeId}_${Date.now()}.${ext}`;
        const contentType = mimeType || 'image/jpeg';

        const { error: uploadErr } = await supabase.storage
            .from('comprobantes')
            .upload(storageName, buffer, { contentType, upsert: true });

        if (uploadErr) throw new Error('Error subiendo a Storage: ' + uploadErr.message);

        const { data: urlData } = supabase.storage.from('comprobantes').getPublicUrl(storageName);
        return res.json({ status: 'success', publicUrl: urlData.publicUrl });

    } catch (err) {
        console.error('[API /upload-comprobante] Error:', err.message);
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// ── /api/guardar-comprobante ─────────────────────────────────────
app.post('/api/guardar-comprobante', async (req, res) => {
    const { venta_id, telefono, foto_url, metodo_pago } = req.body;
    if (!venta_id || !foto_url) {
        return res.status(400).json({ status: 'error', message: 'Datos incompletos' });
    }

    try {
        // Usamos la instancia global (service key) creada al arrancar sin WebSocket
        const supabase = supabaseService;

        const TENANT_ID = process.env.TENANT_ID || 'b33b6851-f016-41f0-9000-91dc234df499';

        // Guardar comprobante
        await supabase.from('comprobantes_pago').insert([{
            venta_id,
            telefono,
            foto_url,
            metodo_pago: metodo_pago || 'nequi',
            estado: 'pendiente',
            tenant_id: TENANT_ID
        }]);

        // Actualizar URL del comprobante en el pedido
        await supabase
            .from('pedidos')
            .update({ comprobante_url: foto_url })
            .eq('venta_id', venta_id);

        return res.json({ status: 'success' });
    } catch (err) {
        console.error('[API /guardar-comprobante] Error:', err.message);
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// ── /api/cancelar-envio-mipaquete ─────────────────────────────────────
app.post('/api/cancelar-envio-mipaquete', async (req, res) => {
    const { mpCode, ventaId, motivo } = req.body;
    try {
        let resultMp = null;
        if (mpCode) {
            const cleanMp = Number(String(mpCode).replace(/[^0-9]/g, ''));
            if (cleanMp) {
                resultMp = await callMiPaqueteAPI('/cancelSending', { mpCode: cleanMp }, crypto.randomUUID(), 'PUT');
                console.log(`[API /cancelar-envio-mipaquete] Cancelando en MiPaquete MP ${cleanMp}:`, resultMp);
            }
        }
        if (ventaId) {
            await supabaseService
                .from('guias')
                .update({ 
                    estado: 'pedido_rechazado_por_comprobante',
                    mensaje: motivo || 'Rechazado'
                })
                .eq('venta_id', ventaId);
        }
        return res.json({ status: 'success', resultMp });
    } catch (err) {
        console.error('[API /cancelar-envio-mipaquete] Error:', err.message);
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// ── /api/actualizar-guia-transportadora ─────────────────────────────
app.post('/api/actualizar-guia-transportadora', async (req, res) => {
    const { ventaId, guiaTransportadora, urlGuia, transportadora, mensaje } = req.body;
    try {
        if (!ventaId) {
            return res.status(400).json({ status: 'error', message: 'ventaId requerido' });
        }
        const updateData = {};
        if (guiaTransportadora !== undefined) updateData.guia_transportadora = guiaTransportadora;
        if (urlGuia !== undefined) updateData.url_guia = urlGuia;
        if (transportadora !== undefined) updateData.transportadora = transportadora;
        if (mensaje !== undefined) updateData.mensaje = mensaje;

        const { data, error } = await supabaseService
            .from('guias')
            .update(updateData)
            .eq('venta_id', ventaId)
            .select()
            .single();

        if (error) throw error;
        return res.json({ status: 'success', data });
    } catch (err) {
        console.error('[API /actualizar-guia-transportadora] Error:', err.message);
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// ── /api/rastreo/:cedula ───────────────────────────────────────────
app.get('/api/rastreo/:cedula', async (req, res) => {
    try {
        const { cedula } = req.params;
        
        // 1. Obtener todas las ventas de esta cédula con sus detalles
        const { data: ventasInfo, error: ventasErr } = await supabaseService
            .from('ventas')
            .select(`
                id, numero_venta, created_at, total,
                detalle_ventas ( modelo, talla, cantidad, precio_unitario )
            `)
            .eq('comprador_numero_documento', cedula)
            .order('created_at', { ascending: false });

        if (ventasErr || !ventasInfo || ventasInfo.length === 0) {
            console.error('[API /rastreo] Error buscando ventas por cédula:', ventasErr);
            return res.status(404).json({ status: 'error', message: 'No se encontraron pedidos para esta cédula' });
        }

        // 2. Obtener las guías de esas ventas
        const ventaIds = ventasInfo.map(v => v.id);
        const { data: guiasInfo, error: guiasErr } = await supabaseService
            .from('guias')
            .select('id, numero_guia, estado, mensaje, venta_id, transportadora, guia_transportadora, mp_code, url_guia')
            .in('venta_id', ventaIds);

        if (guiasErr) {
            console.error('[API /rastreo] Error buscando guías:', guiasErr);
        }

        // Auto-sincronizar con MiPaquete si tiene mp_code pero la guía transportadora está en formato temporal MP o vacía
        for (const guia of (guiasInfo || [])) {
            if (guia.mp_code && (!guia.guia_transportadora || guia.guia_transportadora.startsWith('MP'))) {
                try {
                    const trInfo = await fetchMiPaqueteTracking(guia.mp_code, 1, 0);
                    if (trInfo && trInfo.guideNumber) {
                        guia.guia_transportadora = String(trInfo.guideNumber);
                        if (trInfo.deliveryCompanyName) guia.transportadora = trInfo.deliveryCompanyName;
                        if (!guia.mensaje || guia.mensaje.startsWith('Enviado por')) {
                            guia.mensaje = `Enviado por ${guia.transportadora} #${guia.guia_transportadora}`;
                        }
                        await supabaseService.from('guias').update({
                            guia_transportadora: guia.guia_transportadora,
                            transportadora: guia.transportadora,
                            mensaje: guia.mensaje
                        }).eq('id', guia.id);
                    }
                } catch(e) {
                    console.error('[API /rastreo] Error auto-syncing guia:', e.message);
                }
            }
        }

        // 3. Combinar datos
        const data = ventasInfo.map(venta => {
            const guia = (guiasInfo || []).find(g => g.venta_id === venta.id);
            const numGuiaSistema = guia && guia.numero_guia ? 'GUIA-' + String(guia.numero_guia).padStart(6, '0') : 'Pendiente';
            const carrierGuia = (guia?.guia_transportadora && !guia.guia_transportadora.startsWith('MP')) ? guia.guia_transportadora : '';
            const carrierName = guia?.transportadora || 'ENVIA';
            
            // Si mensaje está vacío o por defecto, componer mensaje útil con la transportadora y número de guía oficial
            let defaultMensaje = guia?.mensaje || '';
            if (!defaultMensaje || defaultMensaje.startsWith('Enviado por')) {
                const guideToShow = carrierGuia || (guia?.mp_code ? ('MP-' + guia.mp_code) : numGuiaSistema);
                defaultMensaje = `Enviado por ${carrierName} #${guideToShow}`;
            }

            return {
                numero_venta: venta.numero_venta,
                fecha: venta.created_at,
                total: venta.total,
                detalles: venta.detalle_ventas || [],
                numero_guia: numGuiaSistema,
                guia_transportadora: carrierGuia,
                transportadora: carrierName,
                mp_code: guia?.mp_code || '',
                url_guia: guia?.url_guia || '',
                estado: guia ? guia.estado : 'pedido_recibido',
                mensaje: defaultMensaje
            };
        });

        return res.json({ status: 'success', data });
    } catch (err) {
        console.error('[API /rastreo] Error interno:', err.message);
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// ── Fallback: SPA index.html ─────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`✅ Atypical Store Catalog corriendo en http://localhost:${PORT}`);
    console.log(`   Supabase URL: ${process.env.SUPABASE_URL ? '✓ configurada' : '✗ FALTA'}`);
    console.log(`   Service Key:  ${process.env.SUPABASE_SERVICE_KEY ? '✓ configurada' : '✗ usando anon key'}`);
});
