/**
 * Supreme Catalog - app.js
 * NO usa import/export ni import.meta.env (compatible con VPS sin bundler).
 * Supabase se carga via CDN (<script> tag en index.html).
 * Las credenciales se obtienen del endpoint /api/config del servidor Express.
 */

// ─────────────────────────────────────────────────────────────
// 0.  SUPABASE INIT (credenciales desde el servidor)
// ─────────────────────────────────────────────────────────────
let dbClient = null;
const { createClient } = window.supabase; // SDK cargado por CDN

async function initSupabase() {
    try {
        // Si hay un servidor Express corriendo, obtenemos config de él
        const res = await fetch('/api/config');
        if (res.ok) {
            const cfg = await res.json();
            window.SHIPPING_TEST_ACTIVE = Boolean(cfg.SHIPPING_TEST_ACTIVE);
            window.TENANT_ID = cfg.TENANT_ID || 'b33b6851-f016-41f0-9000-91dc234df499';
            dbClient = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
            return;
        }
    } catch (_) {
        // No hay servidor Express – modo desarrollo local con hardcoded (SOLO DEV)
    }
    // Fallback desarrollo: lee variables desde window (inyectadas por Vite o nada)
    const url = (typeof __SUPABASE_URL__ !== 'undefined') ? __SUPABASE_URL__ : '';
    const key = (typeof __SUPABASE_KEY__ !== 'undefined') ? __SUPABASE_KEY__ : '';
    if (!url || !key) {
        document.getElementById('loading').innerHTML =
            '<p style="color:#dc2626;">⚠️ No se pudo conectar a la base de datos. Contacta al administrador.</p>';
        throw new Error('Supabase credentials missing');
    }
    dbClient = createClient(url, key);
}

// ─────────────────────────────────────────────────────────────
// 1.  STATE
// ─────────────────────────────────────────────────────────────
let allShoes = [];
let groupedShoes = [];
let currentFilteredShoes = [];
const ITEMS_PER_PAGE = 48;
let currentPage = 1;

const categorias = new Set();
const marcas  = new Set();
const tallasSet = new Set();

// Price range filter state
let priceMin = 0;
let priceMax = 500000;

// Recently updated products (top 20 from historial_mensajes)
let recentlyUpdated = [];

// Active section: 'catalog' (default) or 'ultima-difusion'
let activeSection = 'catalog';

function getProductImageUrl(item) {
    if (item && item.foto_url && typeof item.foto_url === 'string' && item.foto_url.trim().length > 0) {
        return item.foto_url.trim();
    }
    if (item && item.identificador_interno && item.identificador_interno !== 'N/A') {
        const tenantFolder = window.TENANT_ID || 'b33b6851-f016-41f0-9000-91dc234df499';
        return 'https://api.optimalabsconsulting.com/storage/v1/object/public/fotos/' + tenantFolder + '/' + item.identificador_interno + '.jpg';
    }
    return '';
}

// Cart state
let cart = JSON.parse(localStorage.getItem('atypical_cart') || '[]');
// Unique session ID for this browser
let sessionId = localStorage.getItem('atypical_session_id');
if (!sessionId) {
    sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    localStorage.setItem('atypical_session_id', sessionId);
}

// Current shoe for size modal
let pendingShoe = null;
// Current order data
let currentOrder = { items: [], datosEnvio: null, ventaId: null };

// ─────────────────────────────────────────────────────────────
// 2.  DOM REFS
// ─────────────────────────────────────────────────────────────
const recentlyUpdatedSection = document.getElementById('recentlyUpdatedSection');
const recentlyUpdatedGrid    = document.getElementById('recentlyUpdatedGrid');
const priceMinSlider        = document.getElementById('priceMinSlider');
const priceMaxSlider        = document.getElementById('priceMaxSlider');
const priceMinLabel         = document.getElementById('priceMinLabel');
const priceMaxLabel         = document.getElementById('priceMaxLabel');
const priceSliderRange      = document.getElementById('priceSliderRange');
const priceClearBtn         = document.getElementById('priceClearBtn');

const catalogGrid      = document.getElementById('catalogGrid');
const loading          = document.getElementById('loading');
const noResults        = document.getElementById('noResults');
const searchInput      = document.getElementById('searchInput');
const categoriaFilter  = document.getElementById('categoriaFilter');
const marcaFilter      = document.getElementById('marcaFilter');
const tallaFilter      = document.getElementById('tallaFilter');
const paginationContainer = document.getElementById('pagination');

const paginationText   = document.getElementById('paginationText');
const paginationProgress = document.getElementById('paginationProgress');
const paginationNextBtn = document.getElementById('paginationNextBtn');
const paginationPrevBtn = document.getElementById('paginationPrevBtn');
const genderNavBtns    = document.querySelectorAll('.gender-btn');

let activeGender = 'todos'; // 'todos', 'mujer', 'hombre', 'niños', 'guayos'
let activeGuayosSub = 'todos'; // 'todos', 'hombre', 'niño'  (solo aplica cuando activeGender === 'guayos')

const cartBtn          = document.getElementById('cartBtn');
const cartCount        = document.getElementById('cartCount');
const cartOverlay      = document.getElementById('cartOverlay');
const cartDrawer       = document.getElementById('cartDrawer');
const closeCartBtn     = document.getElementById('closeCartBtn');
const cartItemsList    = document.getElementById('cartItems');
const cartFooter       = document.getElementById('cartFooter');
const cartTotalAmount  = document.getElementById('cartTotalAmount');
const checkoutBtn      = document.getElementById('checkoutBtn');

const checkoutModal    = document.getElementById('checkoutModal');
const closeCheckoutBtn = document.getElementById('closeCheckoutBtn');
const closePaymentBtn  = document.getElementById('closePaymentBtn');
const checkoutForm     = document.getElementById('checkoutForm');
const submitCheckoutBtn = document.getElementById('submitCheckoutBtn');
const formError        = document.getElementById('formError');

const step1            = document.getElementById('step1');
const step2            = document.getElementById('step2');
const step3            = document.getElementById('step3');

const copyNequiBtn     = document.getElementById('copyNequiBtn');
const comprobanteInput = document.getElementById('comprobanteInput');
const uploadFileName   = document.getElementById('uploadFileName');
const uploadPreview    = document.getElementById('uploadPreview');
const previewImg       = document.getElementById('previewImg');
const sendComprobanteBtn = document.getElementById('sendComprobanteBtn');
const uploadError      = document.getElementById('uploadError');
const orderSummaryMini = document.getElementById('orderSummaryMini');
const successOrderNum  = document.getElementById('successOrderNum');
const newOrderBtn      = document.getElementById('newOrderBtn');

const sizeModal        = document.getElementById('sizeModal');
const closeSizeModalBtn = document.getElementById('closeSizeModalBtn');
const sizeModalGrid    = document.getElementById('sizeModalGrid');
const sizeModalProductName = document.getElementById('sizeModalProductName');

// Tracking Modal
const openTrackModalBtn = document.getElementById('openTrackModalBtn');
const trackModal = document.getElementById('trackModal');
const closeTrackModalBtn = document.getElementById('closeTrackModalBtn');
const trackForm = document.getElementById('trackForm');
const inputGuia = document.getElementById('inputGuia');
const submitTrackBtn = document.getElementById('submitTrackBtn');
const trackError = document.getElementById('trackError');
const trackResult = document.getElementById('trackResult');

// New Modals & Elements
const sizeGuideModal = document.getElementById('sizeGuideModal');
const closeSizeGuideBtn = document.getElementById('closeSizeGuideBtn');
const howToModal = document.getElementById('howToModal');
const closeHowToBtn = document.getElementById('closeHowToBtn');
const openHowToBtn = document.getElementById('openHowToBtn');
const pickupStore = document.getElementById('pickupStore');
const groupDireccion = document.getElementById('groupDireccion');
const groupCiudad = document.getElementById('groupCiudad');

// ─────────────────────────────────────────────────────────────
// NEW LOGIC: Store Pickup & Modals
// ─────────────────────────────────────────────────────────────
if (pickupStore) {
    pickupStore.addEventListener('change', (e) => {
        const inputDir = document.getElementById('inputDireccion');
        const inputCiu = document.getElementById('inputCiudad');
        if (e.target.checked) {
            inputDir.value = 'Recoge en tienda';
            inputCiu.value = 'Recoge en tienda';
            if (groupDireccion) groupDireccion.style.display = 'none';
            if (groupCiudad) groupCiudad.style.display = 'none';
        } else {
            inputDir.value = '';
            inputCiu.value = '';
            if (groupDireccion) groupDireccion.style.display = 'block';
            if (groupCiudad) groupCiudad.style.display = 'block';
        }
    });
}

const customRemitente = document.getElementById('customRemitente');
const groupRemitente = document.getElementById('groupRemitente');
if (customRemitente && groupRemitente) {
    customRemitente.addEventListener('change', (e) => {
        groupRemitente.style.display = e.target.checked ? 'block' : 'none';
    });
}


if (openHowToBtn) {
    openHowToBtn.addEventListener('click', () => {
        howToModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    });
}

if (closeHowToBtn) {
    closeHowToBtn.addEventListener('click', () => {
        howToModal.style.display = 'none';
        document.body.style.overflow = '';
        const video = howToModal.querySelector('video');
        if (video) video.pause();
    });
}

if (closeSizeGuideBtn) {
    closeSizeGuideBtn.addEventListener('click', () => {
        sizeGuideModal.style.display = 'none';
        document.body.style.overflow = '';
    });
}

window.openSizeGuideModal = (e) => {
    if (e) e.stopPropagation();
    sizeGuideModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
};

// ─────────────────────────────────────────────────────────────
// TOGGLE FILTERS PANEL
// ─────────────────────────────────────────────────────────────
const toggleFiltersBtn = document.getElementById('toggleFiltersBtn');
const filtersPanel     = document.getElementById('filtersPanel');
const filterActiveBadge = document.getElementById('filterActiveBadge');

function updateFilterBadge() {
    if (!filterActiveBadge) return;
    let count = 0;
    const cat = document.getElementById('categoriaFilter');
    const mar = document.getElementById('marcaFilter');
    const tal = document.getElementById('tallaFilter');
    if (cat && cat.value) count++;
    if (mar && mar.value) count++;
    if (tal && tal.value) count++;
    if (priceMin > 0 || priceMax < 500000) count++;
    if (count > 0) {
        filterActiveBadge.textContent = count;
        filterActiveBadge.style.display = 'inline-flex';
    } else {
        filterActiveBadge.style.display = 'none';
    }
}

if (toggleFiltersBtn && filtersPanel) {
    toggleFiltersBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = filtersPanel.classList.contains('open');
        filtersPanel.classList.toggle('open', !isOpen);
        toggleFiltersBtn.setAttribute('aria-expanded', String(!isOpen));
        filtersPanel.setAttribute('aria-hidden', String(isOpen));
    });

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
        if (!filtersPanel.contains(e.target) && !toggleFiltersBtn.contains(e.target)) {
            if (filtersPanel.classList.contains('open')) {
                filtersPanel.classList.remove('open');
                toggleFiltersBtn.setAttribute('aria-expanded', 'false');
                filtersPanel.setAttribute('aria-hidden', 'true');
            }
        }
    });
}

// ─────────────────────────────────────────────────────────────
// 3.  UTILS
// ─────────────────────────────────────────────────────────────
const fallbackSVG = `<svg class="placeholder-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"></path></svg>`;

const formatCurrency = (amount) =>
    new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 })
        .format(amount || 0);

const formatCurrencyShort = (amount) =>
    formatCurrency(amount).replace('COP', '').replace('$\u00a0', '$').trim();

function formatTalla(talla) {
    if (!talla && talla !== 0) return '';
    const str = String(talla).trim();
    if (str.toUpperCase().startsWith('EU')) return str;
    return `EU ${str}`;
}

function saveCart() {
    localStorage.setItem('atypical_cart', JSON.stringify(cart));
    updateCartUI();
}

function showError(el, msg) {
    el.textContent = msg;
    el.style.display = 'block';
}
function hideError(el) {
    el.style.display = 'none';
}

// ─────────────────────────────────────────────────────────────
// 4.  FETCH DATA FROM SUPABASE
// ─────────────────────────────────────────────────────────────
// Columnas mínimas necesarias (reduce el payload ~70% vs select('*'))
const CAMPOS_ZAPATO = 'id,modelo,modelo_interno,identificador_interno,marca,color,foto_url,precio_venta,cantidad,cantidad_reservada,talla,categoria,tenant_id';

// Trae una página directa de Supabase (solo como fallback)
function fetchPageDirect(offset, limit = 1000) {
    const tenantId = window.TENANT_ID || 'b33b6851-f016-41f0-9000-91dc234df499';
    return dbClient
        .from('zapatos')
        .select(CAMPOS_ZAPATO)
        .eq('tenant_id', tenantId)
        .range(offset, offset + limit - 1)
        .then(({ data, error }) => {
            if (error) throw error;
            return data || [];
        });
}

async function fetchRecientes() {
    try {
        const res = await fetch('/api/recientes');
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                recentlyUpdated = data;
            }
        }
    } catch (_) {}
    renderRecentlyUpdated();
}

async function fetchShoes() {
    // ── Intento 1: endpoint cacheado del servidor ────────────────
    // El servidor ya paginó todo en paralelo, seleccionó solo las columnas
    // necesarias y guarda el resultado 5 minutos en memoria.
    // → Primera carga: ~1-2 s (server-to-Supabase rápido)
    // → Recargas dentro de 5 min: instantáneas (caché HIT)
    try {
        const res = await fetch('/api/zapatos');
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                allShoes = data;
                processData();
                populateDropdowns();
                currentFilteredShoes = [...groupedShoes];
                renderCatalog(currentFilteredShoes, 1);
                fetchRecientes();
                return;
            }
        }
    } catch (_) {
        // Sin servidor Express → usamos Supabase directo (desarrollo local)
    }

    // ── Fallback: Supabase directo con carga progresiva ──────────
    // Muestra la primera página inmediatamente mientras carga el resto.
    const first = await fetchPageDirect(0);
    allShoes = first;
    processData();
    populateDropdowns();
    currentFilteredShoes = [...groupedShoes];
    renderCatalog(currentFilteredShoes, 1);   // ← primera página visible YA
    fetchRecientes();

    if (first.length < 1000) return; // no hay más datos

    // Carga el resto en paralelo (en lugar de secuencial)
    const extras = await Promise.all([
        fetchPageDirect(1000),
        fetchPageDirect(2000),
        fetchPageDirect(3000),
        fetchPageDirect(4000),
        fetchPageDirect(5000)
    ]);

    for (const page of extras) {
        allShoes = allShoes.concat(page);
        if (page.length < 1000) break;
    }

    processData();
    currentFilteredShoes = [...groupedShoes];
    renderCatalog(currentFilteredShoes, currentPage);
    fetchRecientes();
}

// ─────────────────────────────────────────────────────────────
// 5.  REAL-TIME STOCK LISTENER
// ─────────────────────────────────────────────────────────────
function setupRealtimeStock() {
    const tenantId = window.TENANT_ID || 'b33b6851-f016-41f0-9000-91dc234df499';
    dbClient
        .channel('public:zapatos:' + tenantId)
        .on('postgres_changes', { 
            event: 'UPDATE', 
            schema: 'public', 
            table: 'zapatos',
            filter: `tenant_id=eq.${tenantId}`
        }, (payload) => {
            const updated = payload.new;
            // Update in allShoes
            const idx = allShoes.findIndex(s => s.id === updated.id);
            if (idx !== -1) allShoes[idx] = { ...allShoes[idx], ...updated };
            // Re-process and re-render
            processData();
            if (window.applyFilters) {
                window.applyFilters(true);
            } else {
                currentFilteredShoes = [...groupedShoes];
                renderCatalog(currentFilteredShoes, currentPage);
            }
            // Update cart items if the shoe changed
            updateCartStockWarnings();
        })
        .subscribe();
}

function updateCartStockWarnings() {
    // Check if any cart item is now out of stock
    cart.forEach(item => {
        const shoe = allShoes.find(s => s.id === item.zapato_id);
        if (shoe) {
            const available = (shoe.cantidad || 0) - (shoe.cantidad_reservada || 0);
            if (available < item.cantidad) {
                item._stockWarning = true;
            } else {
                item._stockWarning = false;
            }
        }
    });
    updateCartUI();
}

// ─────────────────────────────────────────────────────────────
// 6.  DATA PROCESSING
// ─────────────────────────────────────────────────────────────
function processData() {
    const groups = {};
    categorias.clear(); marcas.clear(); tallasSet.clear();

    const TENANT_ID = window.TENANT_ID || 'b33b6851-f016-41f0-9000-91dc234df499';

    allShoes.forEach(shoe => {
        // Filtrar solo zapatos del tenant correcto
        if (shoe.tenant_id !== TENANT_ID) return;

        const available = (shoe.cantidad || 0) - (shoe.cantidad_reservada || 0);
        const key = `${shoe.modelo}-${shoe.identificador_interno || ''}`;

        if (shoe.categoria) categorias.add(shoe.categoria);
        if (shoe.marca) marcas.add(shoe.marca);
        if (shoe.talla && available > 0) tallasSet.add(shoe.talla);

        if (!groups[key]) {
            groups[key] = {
                modelo: shoe.modelo,
                identificador_interno: shoe.identificador_interno || 'N/A',
                modelo_interno: shoe.modelo_interno || '',
                marca: shoe.marca || '',
                categoria: shoe.categoria || '',
                foto_url: shoe.foto_url,
                precio_venta: shoe.precio_venta || 0,
                total_cantidad: 0,
                tallas: []
            };
        }

        const existingTalla = groups[key].tallas.find(t => t.talla === shoe.talla);
        if (existingTalla) {
            existingTalla.cantidad += available;
            existingTalla.zapato_id = shoe.id; // keep latest
        } else {
            groups[key].tallas.push({
                talla: shoe.talla,
                cantidad: available,
                zapato_id: shoe.id,
                precio_unitario: shoe.precio_venta || 0,
                modelo: shoe.modelo,
                foto_url: shoe.foto_url
            });
        }

        groups[key].total_cantidad += available;
        if (!groups[key].foto_url && shoe.foto_url) groups[key].foto_url = shoe.foto_url;
        if ((shoe.precio_venta || 0) > groups[key].precio_venta) groups[key].precio_venta = shoe.precio_venta;
    });

    // Ocultar productos sin precio o completamente agotados (sin ninguna talla disponible)
    groupedShoes = Object.values(groups).filter(g => g.total_cantidad > 0 && g.precio_venta > 0);
    groupedShoes.forEach(g => {
        // Dejar solo tallas con stock > 0
        g.tallas = g.tallas.filter(t => t.cantidad > 0);
        g.tallas.sort((a, b) => String(a.talla).localeCompare(String(b.talla), undefined, { numeric: true }));
    });
    groupedShoes.sort((a, b) => {
        const scoreA = (a.foto_url ? 2 : 0) + (a.precio_venta > 0 ? 1 : 0);
        const scoreB = (b.foto_url ? 2 : 0) + (b.precio_venta > 0 ? 1 : 0);
        return scoreA !== scoreB ? scoreB - scoreA : a.modelo.localeCompare(b.modelo);
    });
}

// ─────────────────────────────────────────────────────────────
// 7.  RENDER CATALOG
// ─────────────────────────────────────────────────────────────
function populateDropdowns() {
    const tsOpts = { create: false, sortField: { field: 'text', direction: 'asc' } };

    Array.from(categorias).filter(Boolean).sort().forEach(c => {
        const o = document.createElement('option'); o.value = c; o.textContent = c;
        categoriaFilter.appendChild(o);
    });
    Array.from(marcas).filter(Boolean).sort().forEach(m => {
        const o = document.createElement('option'); o.value = m; o.textContent = m;
        marcaFilter.appendChild(o);
    });
    // Ordenar tallas numéricamente si es posible
    Array.from(tallasSet).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })).forEach(t => {
        const o = document.createElement('option'); o.value = t; o.textContent = formatTalla(t);
        tallaFilter.appendChild(o);
    });

    new TomSelect('#categoriaFilter', tsOpts);
    new TomSelect('#marcaFilter',  tsOpts);
    new TomSelect('#tallaFilter',  tsOpts);
}

function renderRecentlyUpdated() {
    if (!recentlyUpdatedGrid || recentlyUpdated.length === 0) {
        if (recentlyUpdatedSection) recentlyUpdatedSection.style.display = 'none';
        return;
    }
    if (recentlyUpdatedSection) recentlyUpdatedSection.style.display = (activeSection === 'ultima-difusion') ? 'block' : 'none';
    recentlyUpdatedGrid.innerHTML = '';

    // Los datos vienen como filas individuales de zapatos (no agrupados)
    // Los agrupamos por modelo-identificador_interno
    const groups = {};
    recentlyUpdated.forEach(shoe => {
        const available = (shoe.cantidad || 0) - (shoe.cantidad_reservada || 0);
        const key = `${shoe.modelo}-${shoe.identificador_interno || ''}`;
        if (!groups[key]) {
            groups[key] = {
                modelo: shoe.modelo,
                identificador_interno: shoe.identificador_interno || 'N/A',
                marca: shoe.marca || '',
                categoria: shoe.categoria || '',
                foto_url: shoe.foto_url,
                precio_venta: shoe.precio_venta || 0,
                tallas: []
            };
        }
        const existingTalla = groups[key].tallas.find(t => t.talla === shoe.talla);
        if (existingTalla) {
            existingTalla.cantidad += available;
        } else {
            groups[key].tallas.push({
                talla: shoe.talla,
                cantidad: available,
                zapato_id: shoe.id,
                precio_unitario: shoe.precio_venta || 0,
                modelo: shoe.modelo,
                foto_url: shoe.foto_url
            });
        }
        if (!groups[key].foto_url && shoe.foto_url) groups[key].foto_url = shoe.foto_url;
    });

    const items = Object.values(groups).filter(g => g.precio_venta > 0);

    items.forEach(item => {
        const imageUrl = getProductImageUrl(item);



        const safeModelo = (item.modelo || '').replace(/"/g, '"');
        const safeSvg = fallbackSVG.replace(/"/g, '"');
        const imageContent = imageUrl
            ? `<img src="${imageUrl}" alt="${safeModelo}" class="product-image" loading="lazy" decoding="async" onerror="this.onerror=null; this.outerHTML='${safeSvg}'">`
            : fallbackSVG;

        const sizesHtml = item.tallas
            .filter(t => t.cantidad > 0)
            .map(t => {
                return `<div class="size-badge size-available"
                            data-zapato-id="${t.zapato_id}"
                            data-talla="${t.talla}"
                            data-precio="${t.precio_unitario}"
                            data-modelo="${encodeURIComponent(item.modelo)}"
                            data-foto="${encodeURIComponent(imageUrl)}"
                            onclick="openSizeForItem(event, '${t.zapato_id}', '${encodeURIComponent(item.modelo)}', '${t.talla}', ${t.precio_unitario}, '${encodeURIComponent(imageUrl)}')">
                    <span class="size-val">${formatTalla(t.talla)}</span>
                </div>`;
            }).join('');

        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            <div class="product-image-container" onclick="openLightbox('${encodeURIComponent(imageUrl)}', '${encodeURIComponent(item.modelo)}')">
                ${imageContent}
                <div class="product-badge">🆕 Recién Actualizado</div>
            </div>
            <div class="product-info">
                <h3 class="product-title">${item.modelo}</h3>
                <div class="product-id">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"></path><path d="M4 8h16"></path><path d="M8 4v4"></path></svg>
                    REF: <code>${item.identificador_interno}</code>
                </div>
                <div class="product-price">
                    <span>$</span>${formatCurrencyShort(item.precio_venta).replace('$', '')}
                </div>
                <div class="stock-section">
                    <div class="stock-title">Selecciona tu Talla</div>
                    <div class="sizes-grid">
                        ${sizesHtml || '<span class="no-sizes">Sin tallas disponibles</span>'}
                    </div>
                </div>
                <button class="btn-add-cart" onclick="openSizeModal(event, '${encodeURIComponent(JSON.stringify({...item, foto_url: imageUrl}))}')">
                    🛒 Agregar al Carrito
                </button>
            </div>
        `;
        recentlyUpdatedGrid.appendChild(card);
    });
}

function renderCatalog(items, page = 1) {
    loading.style.display = 'none';
    currentFilteredShoes = items;

    if (items.length === 0) {
        catalogGrid.style.display = 'none';
        paginationContainer.style.display = 'none';
        noResults.style.display = 'block';
        return;
    }

    noResults.style.display = 'none';
    catalogGrid.style.display = 'grid';
    paginationContainer.style.display = 'flex';
    catalogGrid.innerHTML = '';

    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    currentPage = Math.min(Math.max(page, 1), totalPages);

    const pageItems = items.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

    pageItems.forEach(item => {
        const card = document.createElement('div');
        card.className = 'product-card';

        const imageUrl = getProductImageUrl(item);



        const safeModelo = (item.modelo || '').replace(/"/g, '&quot;');
        const safeSvg = fallbackSVG.replace(/"/g, '&quot;');
        const imageContent = imageUrl
            ? `<img src="${imageUrl}" alt="${safeModelo}" class="product-image" loading="lazy" decoding="async" onerror="this.onerror=null; this.outerHTML='${safeSvg}'">`
            : fallbackSVG;

        // Solo badge de disponible, sin cantidad
        const stockBadge = `<div class="product-badge">Disponible</div>`;

        const tagsHtml = [];
        if (item.marca) tagsHtml.push(`<span class="tag-badge">🏷️ ${item.marca}</span>`);
        if (item.color) tagsHtml.push(`<span class="tag-badge">🎨 ${item.color}</span>`);

        // Solo tallas con stock > 0; sin mostrar cantidad
        const sizesHtml = item.tallas
            .filter(t => t.cantidad > 0)
            .map(t => {
                return `<div class="size-badge size-available" 
                            data-zapato-id="${t.zapato_id}"
                            data-talla="${t.talla}"
                            data-precio="${t.precio_unitario}"
                            data-modelo="${encodeURIComponent(item.modelo)}"
                            data-foto="${encodeURIComponent(imageUrl)}"
                            onclick="openSizeForItem(event, '${t.zapato_id}', '${encodeURIComponent(item.modelo)}', '${t.talla}', ${t.precio_unitario}, '${encodeURIComponent(imageUrl)}')">
                    <span class="size-val">${formatTalla(t.talla)}</span>
                </div>`;
            }).join('');

        card.innerHTML = `
            <div class="product-image-container" onclick="openLightbox('${encodeURIComponent(imageUrl)}', '${encodeURIComponent(item.modelo)}')">
                ${imageContent}
                ${stockBadge}
            </div>
            <div class="product-info">
                <h3 class="product-title">${item.modelo}</h3>
                <div class="product-id">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"></path><path d="M4 8h16"></path><path d="M8 4v4"></path></svg>
                    REF: <code>${item.identificador_interno}</code>
                </div>
                ${tagsHtml.length ? `<div class="tags-row">${tagsHtml.join('')}</div>` : ''}
                <div class="product-price">
                    <span>$</span>${formatCurrencyShort(item.precio_venta).replace('$', '')}
                </div>
                <div class="stock-section">
                    <div class="stock-title">Selecciona tu Talla</div>
                    <div class="sizes-grid">
                        ${sizesHtml || '<span class="no-sizes">Sin tallas disponibles</span>'}
                    </div>
                </div>
                <button class="btn-size-guide" onclick="openSizeGuideModal(event)" style="margin-bottom: 0.5rem; background: var(--bg-secondary); color: var(--text); border: 1px solid var(--border); padding: 0.5rem; width: 100%; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-weight: 500; font-size: 0.9rem; transition: background 0.3s;" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='var(--bg-secondary)'">
                    📏 Verifica tu talla aquí
                </button>
                <button class="btn-add-cart" onclick="openSizeModal(event, '${encodeURIComponent(JSON.stringify({...item, foto_url: imageUrl}))}')">
                    🛒 Agregar al Carrito
                </button>
            </div>
        `;

        catalogGrid.appendChild(card);
    });

    renderPagination(totalPages);
}

// ─────────────────────────────────────────────────────────────
// 8.  PAGINATION
// ─────────────────────────────────────────────────────────────
function renderPagination(totalPages) {
    if (totalPages <= 1) { 
        paginationContainer.style.display = 'none'; 
        return; 
    }
    
    paginationContainer.style.display = 'flex';
    paginationText.textContent = `Página: ${currentPage} de ${totalPages}`;
    
    const progressPercent = ((currentPage) / totalPages) * 100;
    paginationProgress.style.width = `${progressPercent}%`;

    paginationPrevBtn.style.display = currentPage > 1 ? 'block' : 'none';
    paginationNextBtn.style.display = currentPage < totalPages ? 'block' : 'none';

    paginationPrevBtn.onclick = () => {
        if (currentPage > 1) {
            renderCatalog(currentFilteredShoes, currentPage - 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };
    
    paginationNextBtn.onclick = () => {
        if (currentPage < totalPages) {
            renderCatalog(currentFilteredShoes, currentPage + 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };
}

// ─────────────────────────────────────────────────────────────
// 9.  FILTERS
// ─────────────────────────────────────────────────────────────
function isSizeInRange(tallaStr, gender) {
    if (!tallaStr) return true;
    
    const t = parseFloat(tallaStr);
    
    // Si no es un numero (como U), mostrar en todas las categorias a menos que se restrinja
    if (isNaN(t)) {
        return true;
    }
    
    if (gender === 'niños') {
        return t >= 30 && t <= 35.5;
    } else if (gender === 'mujer') {
        return t >= 36 && t <= 39.5;
    } else if (gender === 'hombre') {
        return t >= 40 && t <= 44.5;
    }
    
    return true; // para 'todos'
}

function isGuayo(item) {
    // Un producto es guayo si su categoría contiene la palabra 'guayo'
    return (item.categoria || '').toLowerCase().includes('guayo');
}

function setupFilters() {
    const guayosSubnav = document.getElementById('guayosSubnav');
    const guayosSubBtns = document.querySelectorAll('.guayos-sub-btn');

    // ── Helper: format number with dots (Colombian style) ────────
    function formatPrice(num) {
        if (!num && num !== 0) return '';
        return new Intl.NumberFormat('es-CO').format(num);
    }

    // ── Update slider labels and range fill ──────────────────────
    function updateSliderUI() {
        const min = parseInt(priceMinSlider.value, 10);
        const max = parseInt(priceMaxSlider.value, 10);
        const total = parseInt(priceMaxSlider.max, 10);

        // Ensure min <= max
        if (min > max) {
            if (this === priceMinSlider) {
                priceMinSlider.value = max;
            } else {
                priceMaxSlider.value = min;
            }
        }

        const finalMin = parseInt(priceMinSlider.value, 10);
        const finalMax = parseInt(priceMaxSlider.value, 10);

        // Update labels
        priceMinLabel.textContent = finalMin === 0 ? '$0' : `$${formatPrice(finalMin)}`;
        priceMaxLabel.textContent = finalMax >= total ? `$${formatPrice(total)}+` : `$${formatPrice(finalMax)}`;

        // Update range fill
        const leftPct = (finalMin / total) * 100;
        const rightPct = (finalMax / total) * 100;
        priceSliderRange.style.left = leftPct + '%';
        priceSliderRange.style.width = (rightPct - leftPct) + '%';

        // Store current values
        priceMin = finalMin;
        priceMax = finalMax;

        // Apply filter on every slider change (instant feedback)
        window.applyFilters();
    }

    // ── Clear price filter ───────────────────────────────────────
    function clearPriceFilter() {
        priceMinSlider.value = 0;
        priceMaxSlider.value = priceMaxSlider.max;
        updateSliderUI.call(priceMinSlider);
    }

    // ── Show/hide sections based on active tab ───────────────────
    function switchSection(section) {
        activeSection = section;
        const isUltimaDifusion = section === 'ultima-difusion';

        // Show/hide recently updated section
        if (recentlyUpdatedSection) {
            recentlyUpdatedSection.style.display = isUltimaDifusion ? 'block' : 'none';
        }

        // Show/hide catalog grid, pagination, controls
        const controls = document.querySelector('.controls');
        if (controls) controls.style.display = isUltimaDifusion ? 'none' : '';
        if (catalogGrid) catalogGrid.style.display = isUltimaDifusion ? 'none' : '';
        if (paginationContainer) paginationContainer.style.display = isUltimaDifusion ? 'none' : '';
        if (noResults) noResults.style.display = 'none';

        // If switching to ultima-difusion, make sure we have data
        if (isUltimaDifusion && recentlyUpdated.length === 0) {
            fetchRecientes();
        }
    }

    window.applyFilters = (preservePage = false) => {
        const term    = searchInput.value.toLowerCase().trim();
        const selCat  = categoriaFilter.value.toLowerCase().trim();
        const selMar  = marcaFilter.value.toLowerCase().trim();
        const selTalla = tallaFilter ? tallaFilter.value.trim() : '';
        const pMin = priceMin;
        const pMax = priceMax;

        const filtered = groupedShoes.filter(item => {
            const matchText  = term   === '' || item.modelo.toLowerCase().includes(term) || item.identificador_interno.toLowerCase().includes(term);
            const matchCat   = selCat === '' || item.categoria.toLowerCase() === selCat;
            const matchMar   = selMar === '' || item.marca.toLowerCase() === selMar;
            const matchTalla = selTalla === '' || item.tallas.some(t => t.cantidad > 0 && String(t.talla) === selTalla);
            const matchPrice = (!pMin || item.precio_venta >= pMin) && (!pMax || pMax >= 500000 || item.precio_venta <= pMax);
            
            let matchGender = true;

            if (activeGender === 'guayos') {
                if (!isGuayo(item)) { matchGender = false; }
                else if (activeGuayosSub === 'hombre') {
                    matchGender = item.tallas.some(t => t.cantidad > 0 && isSizeInRange(t.talla, 'hombre'));
                } else if (activeGuayosSub === 'niño') {
                    matchGender = item.tallas.some(t => t.cantidad > 0 && isSizeInRange(t.talla, 'niños'));
                } else {
                    matchGender = item.tallas.some(t => t.cantidad > 0);
                }
            } else if (activeGender !== 'todos') {
                matchGender = item.tallas.some(t => t.cantidad > 0 && isSizeInRange(t.talla, activeGender));
            } else {
                matchGender = item.tallas.some(t => t.cantidad > 0);
            }
            
            return matchText && matchCat && matchMar && matchTalla && matchPrice && matchGender;
        });
        
        renderCatalog(filtered, preservePage === true ? currentPage : 1);
        if (typeof updateFilterBadge === 'function') updateFilterBadge();
    };

    searchInput.addEventListener('input', window.applyFilters);
    categoriaFilter.addEventListener('change', window.applyFilters);
    marcaFilter.addEventListener('change', window.applyFilters);
    if (tallaFilter) tallaFilter.addEventListener('change', window.applyFilters);

    // ── Price slider events ──────────────────────────────────────
    if (priceMinSlider) {
        priceMinSlider.addEventListener('input', updateSliderUI);
    }
    if (priceMaxSlider) {
        priceMaxSlider.addEventListener('input', updateSliderUI);
    }
    if (priceClearBtn) {
        priceClearBtn.addEventListener('click', clearPriceFilter);
    }

    // Initialize slider UI
    updateSliderUI.call(priceMinSlider);

    // ── Gender Nav logic (includes "Última Difusión") ────────────
    genderNavBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const gender = e.target.dataset.gender;

            // Handle "última difusión" separately — it's not a gender filter
            if (gender === 'ultima-difusion') {
                genderNavBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                switchSection('ultima-difusion');
                guayosSubnav.style.display = 'none';
                activeGuayosSub = 'todos';
                return;
            }

            // Regular gender filter — switch to catalog view
            switchSection('catalog');
            genderNavBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            activeGender = gender;

            // Mostrar/ocultar sub-nav de guayos
            if (gender === 'guayos') {
                guayosSubnav.style.display = 'flex';
                activeGuayosSub = 'todos';
                guayosSubBtns.forEach(b => b.classList.remove('active'));
                guayosSubBtns[0].classList.add('active');
            } else {
                guayosSubnav.style.display = 'none';
                activeGuayosSub = 'todos';
            }

            window.applyFilters();
        });
    });

    // Sub-filtro de guayos (HOMBRE / NIÑO)
    guayosSubBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            guayosSubBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            activeGuayosSub = e.target.dataset.sub;
            window.applyFilters();
        });
    });
}

// ─────────────────────────────────────────────────────────────
// 10.  SIZE MODAL
// ─────────────────────────────────────────────────────────────
function openSizeModal(event, itemJson) {
    event.stopPropagation();
    const item = JSON.parse(decodeURIComponent(itemJson));
    pendingShoe = item;

    sizeModalProductName.textContent = item.modelo;
    sizeModalGrid.innerHTML = '';

    item.tallas.forEach(t => {
        if (t.cantidad <= 0) return;
        const btn = document.createElement('button');
        btn.className = 'size-picker-btn';
        btn.innerHTML = `<span class="sp-talla">${formatTalla(t.talla)}</span>`;
        btn.onclick = () => {
            addToCart({
                zapato_id: t.zapato_id,
                modelo: item.modelo,
                talla: t.talla,
                cantidad: 1,
                precio_unitario: t.precio_unitario,
                foto_url: item.foto_url || ''
            });
            closeSizeModal();
        };
        sizeModalGrid.appendChild(btn);
    });

    sizeModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function openSizeForItem(event, zapatoId, modeloEnc, talla, precio, fotoEnc) {
    event.stopPropagation();
    addToCart({
        zapato_id: zapatoId,
        modelo: decodeURIComponent(modeloEnc),
        talla,
        cantidad: 1,
        precio_unitario: precio,
        foto_url: decodeURIComponent(fotoEnc)
    });
}

function closeSizeModal() {
    sizeModal.style.display = 'none';
    document.body.style.overflow = '';
}

closeSizeModalBtn.addEventListener('click', closeSizeModal);
sizeModal.addEventListener('click', (e) => { if (e.target === sizeModal) closeSizeModal(); });

// ─────────────────────────────────────────────────────────────
// 11.  CART
// ─────────────────────────────────────────────────────────────
function addToCart(item) {
    // Check real-time stock before adding
    const shoeRow = allShoes.find(s => s.id === item.zapato_id);
    if (shoeRow) {
        const available = (shoeRow.cantidad || 0) - (shoeRow.cantidad_reservada || 0);
        const inCart = cart.filter(c => c.zapato_id === item.zapato_id).reduce((s, c) => s + c.cantidad, 0);
        if (inCart >= available) {
            showToast(`⚠️ Solo hay ${available} unidad(es) disponibles de este zapato.`, 'warning');
            return;
        }
    }

    const existing = cart.find(c => c.zapato_id === item.zapato_id && c.talla === item.talla);
    if (existing) {
        existing.cantidad += 1;
    } else {
        cart.push({ ...item });
    }

    saveCart();
    showToast(`✅ ${item.modelo} ${formatTalla(item.talla)} agregado al carrito`, 'success');
    openCart();
}

function removeFromCart(zapatoId, talla) {
    cart = cart.filter(c => !(c.zapato_id === zapatoId && c.talla === talla));
    saveCart();
}

function changeQty(zapatoId, talla, delta) {
    const item = cart.find(c => c.zapato_id === zapatoId && c.talla === talla);
    if (!item) return;

    if (delta > 0) {
        // Check stock before increasing
        const shoeRow = allShoes.find(s => s.id === zapatoId);
        if (shoeRow) {
            const available = (shoeRow.cantidad || 0) - (shoeRow.cantidad_reservada || 0);
            if (item.cantidad >= available) {
                showToast('⚠️ No hay más unidades disponibles', 'warning');
                return;
            }
        }
    }

    item.cantidad += delta;
    if (item.cantidad <= 0) removeFromCart(zapatoId, talla);
    else saveCart();
}

function getCartTotal() {
    return cart.reduce((s, c) => s + c.precio_unitario * c.cantidad, 0);
}

function updateCartUI() {
    const total = cart.reduce((s, c) => s + c.cantidad, 0);
    cartCount.textContent = total;
    cartCount.style.display = total > 0 ? 'flex' : 'none';

    if (cart.length === 0) {
        cartItemsList.innerHTML = `
            <div style="text-align:center; padding: 2rem 1rem;">
                <p class="empty-cart-msg" style="margin-bottom:1.5rem;">Tu carrito está vacío</p>
                <button onclick="closeCart()" style="background:var(--accent); color:#fff; border:none; padding:0.75rem 1.5rem; border-radius:10px; font-size:1rem; font-weight:600; cursor:pointer; transition:opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">🛍️ Seguir Comprando</button>
            </div>`;
        cartFooter.style.display = 'none';
        return;
    }

    cartFooter.style.display = 'block';
    cartTotalAmount.textContent = formatCurrencyShort(getCartTotal());

    cartItemsList.innerHTML = cart.map(item => `
        <div class="cart-item ${item._stockWarning ? 'cart-item-warning' : ''}">
            <div class="cart-item-img">
                ${item.foto_url ? `<img src="${item.foto_url}" alt="${item.modelo}" onerror="this.style.display='none'">` : ''}
            </div>
            <div class="cart-item-info">
                <div class="cart-item-name">${item.modelo}</div>
                <div class="cart-item-talla">${formatTalla(item.talla)}</div>
                ${item._stockWarning ? '<div class="stock-warning-text">⚠️ Stock insuficiente — actualiza tu carrito</div>' : ''}
                <div class="cart-item-price">${formatCurrencyShort(item.precio_unitario * item.cantidad)}</div>
            </div>
            <div class="cart-item-actions">
                <button onclick="changeQty('${item.zapato_id}', '${item.talla}', -1)" class="qty-btn">−</button>
                <span class="qty-num">${item.cantidad}</span>
                <button onclick="changeQty('${item.zapato_id}', '${item.talla}', 1)" class="qty-btn">+</button>
                <button onclick="removeFromCart('${item.zapato_id}', '${item.talla}')" class="remove-btn">🗑</button>
            </div>
        </div>
    `).join('') + `
    <div style="text-align:center; padding: 0.75rem 0 0.25rem;">
        <button onclick="closeCart()" style="background:transparent; color:var(--text-dim); border:1px solid var(--border); padding:0.6rem 1.25rem; border-radius:8px; font-size:0.9rem; font-weight:500; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-dim)'">🛍️ Seguir Comprando</button>
    </div>`;
}

function openCart() {
    cartDrawer.classList.add('open');
    cartOverlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeCart() {
    cartDrawer.classList.remove('open');
    cartOverlay.classList.remove('visible');
    document.body.style.overflow = '';
}

cartBtn.addEventListener('click', openCart);
closeCartBtn.addEventListener('click', closeCart);
cartOverlay.addEventListener('click', closeCart);

// ─────────────────────────────────────────────────────────────
// 12.  CHECKOUT FLOW
// ─────────────────────────────────────────────────────────────
checkoutBtn.addEventListener('click', () => {
    // Validate cart stock before checkout
    const hasWarning = cart.some(c => c._stockWarning);
    if (hasWarning) {
        showToast('⚠️ Algunos productos en tu carrito ya no tienen suficiente stock. Por favor revísalos.', 'warning');
        return;
    }
    if (cart.length === 0) return;

    closeCart();
    currentOrder.items = [...cart];
    openModal(step1);
});

closeCheckoutBtn.addEventListener('click', () => closeCheckoutModal());
closePaymentBtn.addEventListener('click', () => closeCheckoutModal());

function openModal(stepEl) {
    [step1, step2, step3].forEach(s => s.style.display = 'none');
    stepEl.style.display = 'block';
    checkoutModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeCheckoutModal() {
    checkoutModal.style.display = 'none';
    document.body.style.overflow = '';
}

// Close modal when clicking backdrop
checkoutModal.addEventListener('click', (e) => {
    if (e.target === checkoutModal) closeCheckoutModal();
});

// Live Shipping Quote via MiPaquete
let currentShippingQuote = {
    cost: 0,
    carrierName: '',
    carrierId: null,
    sessionTracker: null,
    requiresManualQuote: false,
    disabled: true
};


const inputCiudad = document.getElementById('inputCiudad');
const shippingQuoteBox = document.getElementById('shippingQuoteBox');
const shippingCarrierBadge = document.getElementById('shippingCarrierBadge');
const shippingCostDisplay = document.getElementById('shippingCostDisplay');

async function updateShippingQuote() {
    if (!inputCiudad) return;

    // Si el modo prueba de envíos está inactivo (o ya se completaron las 2 compras), ocultar y salir
    if (window.SHIPPING_TEST_ACTIVE === false) {
        if (shippingQuoteBox) shippingQuoteBox.style.display = 'none';
        currentShippingQuote = {
            cost: 0,
            carrierName: '',
            carrierId: null,
            sessionTracker: null,
            requiresManualQuote: false,
            disabled: true
        };
        return;
    }

    const ciudadVal = inputCiudad.value.trim();
    if (!ciudadVal) {
        if (shippingQuoteBox) shippingQuoteBox.style.display = 'none';
        return;
    }

    try {
        const totalProductos = typeof getCartTotal === 'function' ? getCartTotal() : 140000;
        const totalCantidad = (typeof cart !== 'undefined' && Array.isArray(cart))
            ? cart.reduce((acc, item) => acc + (Number(item.cantidad) || 1), 0)
            : 1;

        const res = await fetch('/api/cotizar-envio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ciudad: ciudadVal,
                valorDeclarado: totalProductos || (totalCantidad * 140000),
                peso: 1,
                cantidad: totalCantidad
            })
        });

        if (res.ok) {
            const data = await res.json();

            // Si el servidor indica que el cotizador está inactivo o superó las 2 compras
            if (data.status === 'disabled' || data.enabled === false) {
                window.SHIPPING_TEST_ACTIVE = false;
                if (shippingQuoteBox) shippingQuoteBox.style.display = 'none';
                currentShippingQuote = {
                    cost: 0,
                    carrierName: '',
                    carrierId: null,
                    sessionTracker: null,
                    requiresManualQuote: false,
                    disabled: true
                };
                return;
            }

            if (data.requiresManualQuote || totalCantidad > 11) {
                currentShippingQuote = {
                    cost: 0,
                    carrierName: 'Cotización Manual (Personal)',
                    carrierId: null,
                    requiresManualQuote: true,
                    sessionTracker: null,
                    disabled: false
                };

                if (shippingCarrierBadge) {
                    shippingCarrierBadge.textContent = 'Cotización Manual';
                    shippingCarrierBadge.style.background = '#ea580c';
                }
                if (shippingCostDisplay) {
                    shippingCostDisplay.innerHTML = `⚠️ Pedido de <strong>${totalCantidad} pares</strong>: <em>Requiere cotización manual de envío por nuestro personal tras registrar la orden.</em>`;
                }
                if (shippingQuoteBox) shippingQuoteBox.style.display = 'block';
                return;
            }

            const c = data.selectedCarrier || data.cheapestCarrier;
            if (c) {
                currentShippingQuote = {
                    cost: c.cost || 18800,
                    carrierName: c.name || 'ENVÍA',
                    carrierId: c.deliveryCompanyId || '6080a75ef08a770ddd9724fd',
                    sessionTracker: data.sessionTracker,
                    requiresManualQuote: false,
                    disabled: false
                };

                if (shippingCarrierBadge) {
                    shippingCarrierBadge.textContent = currentShippingQuote.carrierName;
                    shippingCarrierBadge.style.background = '';
                }
                if (shippingCostDisplay) {
                    shippingCostDisplay.innerHTML = `Costo de Envío Cotizado (${totalCantidad} zapato${totalCantidad > 1 ? 's' : ''}): <strong>$${Number(currentShippingQuote.cost).toLocaleString('es-CO')} COP</strong>`;
                }
                if (shippingQuoteBox) shippingQuoteBox.style.display = 'block';
            }
        }
    } catch (err) {
        console.warn('Error cotizando envío:', err.message);
    }
}


let quoteDebounceTimer = null;
if (inputCiudad) {
    inputCiudad.addEventListener('input', () => {
        clearTimeout(quoteDebounceTimer);
        quoteDebounceTimer = setTimeout(updateShippingQuote, 350);
    });
    inputCiudad.addEventListener('blur', updateShippingQuote);
    inputCiudad.addEventListener('change', updateShippingQuote);
}


// STEP 1: Collect user data
checkoutForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError(formError);

    const nombre    = document.getElementById('inputNombre').value.trim();
    const cedula    = document.getElementById('inputCedula').value.trim();
    const telefono  = document.getElementById('inputTelefono').value.trim();
    const direccion = document.getElementById('inputDireccion').value.trim();
    const ciudad    = document.getElementById('inputCiudad').value.trim();

    if (!nombre || !cedula || !telefono || !direccion || !ciudad) {
        showError(formError, 'Por favor completa todos los campos obligatorios.');
        return;
    }
    if (!/^\d{6,12}$/.test(cedula)) {
        showError(formError, 'El número de cédula no parece válido (solo números, 6-12 dígitos).');
        return;
    }
    if (!/^\d{10}$/.test(telefono.replace(/\s/g, ''))) {
        showError(formError, 'El celular debe tener 10 dígitos (ej: 3001234567).');
        return;
    }

    let datosRemitente = null;
    const isCustomRemitente = document.getElementById('customRemitente');
    if (isCustomRemitente && isCustomRemitente.checked) {
        datosRemitente = {
            nombre: document.getElementById('inputRemitenteNombre').value.trim(),
            telefono: document.getElementById('inputRemitenteTelefono').value.trim(),
            direccion: document.getElementById('inputRemitenteDireccion').value.trim(),
            ciudad: document.getElementById('inputRemitenteCiudad').value.trim()
        };
    }

    // Asegurar cotización de envío actualizada si el modo de prueba de envío está activo
    if (window.SHIPPING_TEST_ACTIVE !== false && currentShippingQuote.cost === 0 && !currentShippingQuote.disabled) {
        await updateShippingQuote();
    }

    const isTestActive = (window.SHIPPING_TEST_ACTIVE !== false) && !currentShippingQuote.disabled;

    currentOrder.datosEnvio = { 
        nombreCliente: nombre, 
        cedula, 
        telefono, 
        direccion, 
        ciudad, 
        datosRemitente,
        transportadoraId: isTestActive ? currentShippingQuote.carrierId : null,
        transportadoraNombre: isTestActive ? currentShippingQuote.carrierName : null,
        valorEnvio: isTestActive ? currentShippingQuote.cost : 0,
        sessionTracker: isTestActive ? currentShippingQuote.sessionTracker : null
    };

    submitCheckoutBtn.disabled = true;
    submitCheckoutBtn.textContent = 'Procesando...';

    try {
        let shippingHtml = '';
        if (isTestActive) {
            shippingHtml = currentShippingQuote.requiresManualQuote
                ? `🚚 Envío: <strong style="color:#d97706;">Pendiente de cotización manual</strong> (Pedido mayor a 11 pares — coordinado por personal)`
                : `🚚 Envío: <strong>$${(currentShippingQuote.cost || 18800).toLocaleString('es-CO')} COP</strong> (${currentShippingQuote.carrierName || 'ENVÍA'}) — <em>Pago Contraentrega a la transportadora</em>`;
        }

        // Build order summary for payment step
        orderSummaryMini.innerHTML = `
            <div class="order-items-mini">
                ${currentOrder.items.map(i => `<div>• ${i.modelo} (${formatTalla(i.talla)}) x${i.cantidad} — ${formatCurrencyShort(i.precio_unitario * i.cantidad)}</div>`).join('')}
                ${shippingHtml ? `
                <div style="margin-top:0.4rem; padding-top:0.4rem; border-top:1px dashed var(--border); color:#d97706; font-size:0.85rem;">
                    ${shippingHtml}
                </div>` : ''}
            </div>
            <div class="order-total-mini"><strong>Total Productos: ${formatCurrencyShort(getCartTotal())}</strong></div>
        `;

        openModal(step2);
    } catch (err) {
        showError(formError, err.message || 'Error al procesar tu orden. Intenta nuevamente.');
    } finally {
        submitCheckoutBtn.disabled = false;
        submitCheckoutBtn.textContent = 'Continuar al Pago →';
    }
});


// Copy Bancolombia account number
if (copyNequiBtn) {
    copyNequiBtn.addEventListener('click', () => {
        const nequiNumberEl = document.getElementById('nequiNumber');
        const accountNumber = nequiNumberEl ? nequiNumberEl.textContent.trim() : '';
        if (!accountNumber) return;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(accountNumber).then(() => {
                showToast('📋 Número de cuenta copiado al portapapeles', 'success');
            }).catch(() => {
                fallbackCopyAccount(accountNumber);
            });
        } else {
            fallbackCopyAccount(accountNumber);
        }
    });
}

function fallbackCopyAccount(text) {
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful) {
            showToast('📋 Número de cuenta copiado al portapapeles', 'success');
        } else {
            showToast('No se pudo copiar automáticamente', 'error');
        }
    } catch (err) {
        showToast('No se pudo copiar automáticamente', 'error');
    }
}

// File upload preview
comprobanteInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // VALIDAR ARCHIVO NO EN BLANCO
    if (file.size < 5120) { // Menos de 5KB (archivo dañado o en blanco)
        showError(uploadError, 'El archivo parece estar vacío o dañado. Por favor, sube un comprobante válido.');
        comprobanteInput.value = ''; // limpiar
        uploadFileName.textContent = 'Haz clic aquí o arrastra la imagen';
        uploadPreview.style.display = 'none';
        sendComprobanteBtn.disabled = true;
        return;
    }
    hideError(uploadError);

    uploadFileName.textContent = file.name;
    sendComprobanteBtn.disabled = false;

    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            previewImg.src = ev.target.result;
            uploadPreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    } else {
        uploadPreview.style.display = 'none';
    }
});

// Drag-and-drop on upload label
const uploadLabel = document.querySelector('.upload-label');
uploadLabel.addEventListener('dragover', (e) => { e.preventDefault(); uploadLabel.classList.add('drag-over'); });
uploadLabel.addEventListener('dragleave', () => uploadLabel.classList.remove('drag-over'));
uploadLabel.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadLabel.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) {
        comprobanteInput.files = e.dataTransfer.files;
        comprobanteInput.dispatchEvent(new Event('change'));
    }
});

// STEP 2: Upload comprobante
sendComprobanteBtn.addEventListener('click', async () => {
    const file = comprobanteInput.files[0];
    if (!file) {
        showError(uploadError, 'Por favor selecciona el comprobante de pago.');
        return;
    }
    if (file.size < 5120) { // Menos de 5KB
        showError(uploadError, 'El comprobante parece estar vacío o dañado. Por favor sube un archivo correcto.');
        return;
    }
    hideError(uploadError);

    sendComprobanteBtn.disabled = true;
    sendComprobanteBtn.textContent = 'Procesando imagen...';

    try {
        // ── Convertir a base64 (y comprimir si es imagen grande) ──────────
        // Usamos base64+JSON en vez de FormData porque es 100% compatible con
        // iOS Safari, Chrome mobile y todos los browsers sin errores "Load failed".
        let base64Data;
        let mimeType = file.type || 'image/jpeg';

        if (file.type.startsWith('image/') && file.type !== 'image/gif') {
            // Comprimir y convertir a base64 en un solo paso
            base64Data = await compressToBase64(file, 0.78);
            mimeType = 'image/jpeg';
        } else {
            // PDF u otro archivo → base64 directo sin comprimir
            base64Data = await fileToBase64(file);
        }

        // ── 1. CREAR LA ORDEN Y RESERVAR EL ZAPATO ─────────────────────
        sendComprobanteBtn.textContent = 'Reservando zapato...';
        
        const createRes = await fetch('/api/crear-orden', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telefono: currentOrder.datosEnvio.telefono,
                items: currentOrder.items.map(i => ({
                    zapato_id: i.zapato_id,
                    modelo: i.modelo,
                    talla: i.talla,
                    cantidad: i.cantidad
                })),
                datosEnvio: currentOrder.datosEnvio
            })
        });

        const createResult = await createRes.json();
        if (!createRes.ok || createResult.status === 'error') {
            throw new Error(createResult.message || 'No se pudo reservar el zapato.');
        }

        if (createResult.shippingTestActive !== undefined) {
            window.SHIPPING_TEST_ACTIVE = Boolean(createResult.shippingTestActive);
            if (!window.SHIPPING_TEST_ACTIVE && shippingQuoteBox) {
                shippingQuoteBox.style.display = 'none';
            }
        }

        currentOrder.ventaId     = createResult.ventaId;
        currentOrder.numeroVenta = createResult.numeroVenta;
        currentOrder.numeroGuia  = createResult.numeroGuia;

        // ── 2. SUBIR EL COMPROBANTE AL SERVIDOR ───────────────────────
        sendComprobanteBtn.textContent = 'Subiendo comprobante...';

        // Enviar al servidor como JSON (más fiable en móvil que FormData)
        const uploadRes = await fetch('/api/upload-comprobante', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                venta_id:  currentOrder.ventaId,
                fileData:  base64Data,
                fileName:  file.name || `comprobante.${mimeType === 'image/jpeg' ? 'jpg' : 'pdf'}`,
                mimeType
            })
        });

        if (!uploadRes.ok) {
            const errData = await uploadRes.json().catch(() => ({}));
            throw new Error(errData.message || `Error del servidor (${uploadRes.status})`);
        }

        const resData = await uploadRes.json();
        const publicUrl = resData.publicUrl;
        if (!publicUrl) throw new Error('No se obtuvo URL del comprobante');

        // ── Guardar referencia en la BD ───────────────────────────────────
        await fetch('/api/guardar-comprobante', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                venta_id:    currentOrder.ventaId,
                telefono:    currentOrder.datosEnvio.telefono,
                foto_url:    publicUrl,
                metodo_pago: 'nequi'
            })
        });

        // Clear cart y mostrar confirmación
        cart = [];
        saveCart();
        successOrderNum.textContent = `Orden: ${currentOrder.numeroVenta}`;
        
        // Ya no se muestra el número de guía aquí, el usuario rastrea por cédula
        
        openModal(step3);

    } catch (err) {
        console.error('[upload-comprobante]', err);
        const msg = err.message || '';
        showError(uploadError, '❌ ' + (msg || 'Error al subir el comprobante. Intenta de nuevo.'));
    } finally {
        sendComprobanteBtn.disabled = false;
        sendComprobanteBtn.textContent = 'Enviar Comprobante ✓';
    }
});

// Convierte File/Blob a string base64 (data URL) usando FileReader
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('Error leyendo el archivo'));
        reader.readAsDataURL(file);
    });
}

// Comprime imagen y devuelve base64. Límite 1600px, calidad configurable.
// Compatible con iOS (usa Image + canvas, evita HEIC issues con onerror fallback)
function compressToBase64(file, quality = 0.78) {
    if (file.type === 'application/pdf' || (file.name && file.name.toLowerCase().endsWith('.pdf'))) {
        return fileToBase64(file);
    }
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);
            const MAX = 1600;
            let w = img.width, h = img.height;
            if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
            if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }

            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';   // fondo blanco (por si hay transparencia)
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);

            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            resolve(dataUrl);
        };

        img.onerror = () => {
            // Fallback: si canvas no puede procesar (ej: HEIC en algunos devices),
            // leer el archivo directamente como base64
            URL.revokeObjectURL(url);
            fileToBase64(file).then(resolve).catch(reject);
        };

        img.src = url;
    });
}


// STEP 3: New order
newOrderBtn.addEventListener('click', () => {
    closeCheckoutModal();
    currentOrder = { items: [], datosEnvio: null, ventaId: null };
    checkoutForm.reset();
    comprobanteInput.value = '';
    uploadFileName.textContent = 'Haz clic aquí o arrastra la imagen';
    uploadPreview.style.display = 'none';
    sendComprobanteBtn.disabled = true;
});

// ─────────────────────────────────────────────────────────────
// 13.  TOAST NOTIFICATIONS
// ─────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-show'));
    setTimeout(() => {
        toast.classList.remove('toast-show');
        setTimeout(() => toast.remove(), 400);
    }, 3200);
}

// ─────────────────────────────────────────────────────────────
// 15.  LIGHTBOX
// ─────────────────────────────────────────────────────────────
function openLightbox(encodedUrl, encodedName) {
    const url  = decodeURIComponent(encodedUrl);
    const name = decodeURIComponent(encodedName);
    if (!url) return;

    // Remove any existing lightbox
    const existing = document.getElementById('lightboxOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'lightboxOverlay';
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = `
        <div class="lightbox-inner" onclick="event.stopPropagation()">
            <button class="lightbox-close" onclick="closeLightbox()" title="Cerrar">×</button>
            <img src="${url}" alt="${name}" onerror="this.src=''; this.parentElement.innerHTML='<p style=\"color:#94a3b8;padding:2rem\">Imagen no disponible</p>'">
            <div class="lightbox-caption">${name}</div>
        </div>
    `;
    overlay.addEventListener('click', closeLightbox);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Cerrar con ESC
    document.addEventListener('keydown', _lbEscHandler);
}

function _lbEscHandler(e) {
    if (e.key === 'Escape') closeLightbox();
}

function closeLightbox() {
    const overlay = document.getElementById('lightboxOverlay');
    if (overlay) overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', _lbEscHandler);
}

// ─────────────────────────────────────────────────────────────
// 16.  TRACKING (RASTREO)
// ─────────────────────────────────────────────────────────────
if (openTrackModalBtn) {
    openTrackModalBtn.addEventListener('click', () => {
        trackModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    });
}

if (closeTrackModalBtn) {
    closeTrackModalBtn.addEventListener('click', closeTrackModal);
    trackModal.addEventListener('click', (e) => {
        if (e.target === trackModal) closeTrackModal();
    });
}

function closeTrackModal() {
    trackModal.style.display = 'none';
    document.body.style.overflow = '';
    trackResult.style.display = 'none';
    trackError.style.display = 'none';
    inputGuia.value = '';
}

if (trackForm) {
    trackForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const cedula = inputGuia.value.trim();
        if (!cedula) return;

        submitTrackBtn.disabled = true;
        submitTrackBtn.textContent = 'Buscando...';
        trackError.style.display = 'none';
        trackResult.style.display = 'none';

        try {
            const res = await fetch(`/api/rastreo/${encodeURIComponent(cedula)}`);
            const json = await res.json();

            if (!res.ok || json.status === 'error') {
                throw new Error(json.message || 'Error al buscar el pedido');
            }

            const data = json.data;
            // data es un array de pedidos: [{ numero_venta, fecha, numero_guia, estado, mensaje }, ...]

            if (!Array.isArray(data) || data.length === 0) {
                throw new Error('No se encontraron pedidos.');
            }

            trackResult.innerHTML = ''; // Limpiar resultados anteriores
            
            data.forEach((pedido, index) => {
                const statusFlow = ['pedido_recibido', 'pedido_aprobado', 'pedido_despachado'];
                let currentIdx = statusFlow.indexOf(pedido.estado);
                
                let isRejected = pedido.estado === 'pedido_rechazado_por_comprobante';
                const fechaFormat = new Date(pedido.fecha).toLocaleDateString();
                
                // Formatear los artículos comprados
                const detallesHtml = pedido.detalles.map(d => `
                    <div style="display: flex; justify-content: space-between; font-size: 0.9rem; padding: 0.25rem 0;">
                        <span>${d.cantidad}x ${d.modelo} (${formatTalla(d.talla)})</span>
                    </div>
                `).join('');

                let timelineHtml = '';

                if (isRejected) {
                    timelineHtml = `
                        <div style="text-align: center; color: #dc2626; margin-top: 1rem;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:0.5rem;"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                            <h4 style="margin: 0 0 0.25rem;">Pedido Rechazado</h4>
                            <p style="margin: 0; font-size: 0.9rem;">El comprobante enviado no fue aprobado.</p>
                            ${pedido.mensaje ? `<div style="background: rgba(220,38,38,0.1); padding: 0.75rem; border-radius: 6px; margin-top: 0.5rem; text-align: left; font-size: 0.85rem;"><strong>Mensaje:</strong> ${pedido.mensaje}</div>` : ''}
                        </div>
                    `;
                } else {
                    if (currentIdx === -1) currentIdx = 0; // Default if unknown
                    const stepsHtml = statusFlow.map((st, idx) => {
                        const active = idx <= currentIdx ? 'color: var(--primary); font-weight: bold;' : 'color: var(--text-muted); opacity: 0.5;';
                        const icon = idx < currentIdx ? '✅' : (idx === currentIdx ? '🔄' : '⏳');
                        const title = st === 'pedido_recibido' ? 'Pedido Recibido' : (st === 'pedido_aprobado' ? 'Pago Confirmado' : 'Pedido Despachado');
                        
                        return `
                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; ${active}">
                                <div style="font-size: 1.2rem;">${icon}</div>
                                <div>
                                    <div style="font-size: 0.9rem;">${title}</div>
                                </div>
                            </div>
                        `;
                    }).join('');
                    
                    const carrierGuia = pedido.guia_transportadora || '';
                    const carrierName = pedido.transportadora || 'ENVÍA';
                    const hasCarrierGuia = Boolean(carrierGuia && carrierGuia !== pedido.numero_guia);

                    const carrierBoxHtml = hasCarrierGuia ? `
                        <div style="background: rgba(245, 158, 11, 0.12); border: 1.5px solid #f59e0b; padding: 0.85rem; border-radius: 8px; margin: 1rem 0; display: flex; flex-direction: column; gap: 0.35rem;">
                            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                                <span style="font-weight: 800; color: #b45309; font-size: 0.9rem; text-transform: uppercase;">🚚 Transportadora: ${carrierName}</span>
                                <span style="background: #fef3c7; color: #92400e; font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 4px; font-weight: 700;">Guía Oficial</span>
                            </div>
                            <div style="font-size: 1rem; color: var(--text-color);">
                                Nº Guía: <strong style="font-family: monospace; font-size: 1.15rem; letter-spacing: 0.5px; color: var(--text-color);">${carrierGuia}</strong>
                            </div>
                            ${carrierName.toUpperCase().includes('ENV') ? `
                                <a href="https://www.enviacolvanes.com/" target="_blank" rel="noopener noreferrer" style="align-self: flex-start; margin-top: 0.25rem; font-size: 0.8rem; font-weight: 700; color: #b45309; text-decoration: underline;">
                                    🔍 Rastrear en portal de ENVÍA &rarr;
                                </a>
                            ` : ''}
                        </div>
                    ` : '';

                    timelineHtml = `
                        ${carrierBoxHtml}
                        <div style="padding-left: 0.5rem; border-left: 2px solid var(--border); margin-left: 0.5rem; margin-top: 1rem;">
                            ${stepsHtml}
                        </div>
                        ${pedido.mensaje ? `<div style="background: rgba(124, 58, 237, 0.1); border-left: 4px solid var(--primary); padding: 0.75rem; margin-top: 1rem; border-radius: 4px; font-size: 0.85rem;"><strong>Nota:</strong> ${pedido.mensaje}</div>` : ''}
                    `;
                }

                const isFirst = index === 0;
                const pedidoHtml = `
                    <div style="margin-bottom: 1rem; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--bg-color);">
                        <div onclick="const body = this.nextElementSibling; const icon = this.querySelector('.toggle-icon'); if (body.style.display === 'none') { body.style.display = 'block'; icon.textContent = '▲'; } else { body.style.display = 'none'; icon.textContent = '▼'; }" style="background: var(--bg-secondary); padding: 1rem; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none;">
                            <div>
                                <h3 style="margin: 0; font-size: 1rem; color: var(--text-color);">Fecha: ${fechaFormat}</h3>
                                <p style="margin: 0.25rem 0 0; color: var(--text-muted); font-size: 0.85rem;">Guía: <strong style="color: var(--primary);">${pedido.numero_guia}</strong></p>
                            </div>
                            <div class="toggle-icon" style="color: var(--text-muted); font-size: 0.8rem; padding: 0.5rem;">
                                ${isFirst ? '▲' : '▼'}
                            </div>
                        </div>
                        <div style="display: ${isFirst ? 'block' : 'none'}; padding: 1.25rem; border-top: 1px solid var(--border);">
                            <div style="margin-bottom: 1.5rem;">
                                <h4 style="margin: 0 0 0.5rem; font-size: 0.95rem; color: var(--text-color);">Artículos comprados:</h4>
                                ${detallesHtml}
                            </div>
                            <h4 style="margin: 0 0 0.5rem; font-size: 0.95rem; color: var(--text-color); border-top: 1px solid var(--border); padding-top: 1.25rem;">Estado del envío:</h4>
                            ${timelineHtml}
                        </div>
                    </div>
                `;
                
                trackResult.innerHTML += pedidoHtml;
            });
            
            trackResult.style.display = 'block';

        } catch (err) {
            trackError.textContent = err.message || 'No se encontraron pedidos con ese número de cédula.';
            trackError.style.display = 'block';
        } finally {
            submitTrackBtn.disabled = false;
            submitTrackBtn.textContent = 'Buscar';
        }
    });
}

// ─────────────────────────────────────────────────────────────
// 14.  INIT
// ─────────────────────────────────────────────────────────────
async function applyLandingConfig() {
    try {
        const tenantId = window.TENANT_ID || 'b33b6851-f016-41f0-9000-91dc234df499';
        const { data, error } = await dbClient
            .from('landing_settings')
            .select('*')
            .eq('tenant_id', tenantId)
            .maybeSingle();
        if (error) return;
        if (data) {
            if (document.getElementById('pagoBancoNombre')) document.getElementById('pagoBancoNombre').textContent = 'Pago por ' + data.banco_nombre;
            if (document.getElementById('pagoTitular')) document.getElementById('pagoTitular').textContent = data.titular;
            if (document.getElementById('pagoCedula')) document.getElementById('pagoCedula').textContent = data.cedula;
            if (document.getElementById('nequiNumber')) document.getElementById('nequiNumber').textContent = data.numero_cuenta;
            
            const tipoCuenta = (data.tipo_cuenta && data.tipo_cuenta.trim()) ? data.tipo_cuenta.trim() : 'Ahorros';
            if (document.getElementById('pagoTipoCuentaLabel')) {
                if (/^(no\.|cuenta)/i.test(tipoCuenta)) {
                    document.getElementById('pagoTipoCuentaLabel').textContent = tipoCuenta;
                } else {
                    document.getElementById('pagoTipoCuentaLabel').textContent = 'No. Cuenta (' + tipoCuenta + ')';
                }
            }
            if (document.getElementById('pagoTransferenciaTexto')) {
                document.getElementById('pagoTransferenciaTexto').textContent = 'Realiza tu transferencia a la siguiente cuenta (' + tipoCuenta + '):';
            }
            
            if (data.tipo_fondo === 'color' && data.valor_fondo) {
                document.body.style.background = data.valor_fondo;
                document.body.style.backgroundImage = '';
            } else if (data.tipo_fondo === 'imagen' && data.valor_fondo) {
                document.body.style.backgroundImage = `url('${data.valor_fondo}')`;
                document.body.style.backgroundSize = 'cover';
                document.body.style.backgroundPosition = 'center top';
                document.body.style.backgroundAttachment = 'fixed';
                document.body.style.backgroundRepeat = 'no-repeat';

                // Agregar clase para que el CSS maneje el overlay y el contraste del header
                document.body.classList.add('has-bg-image');
            }
        }
    } catch (e) {
        console.log('Error loading landing config:', e);
    }
}

async function init() {
    try {
        await initSupabase();
        applyLandingConfig();
        await fetchShoes();
        setupFilters();
        setupRealtimeStock();
        updateCartUI();
        initTheme();
        
        // Listener para el botón de tema
        const themeToggleBtn = document.getElementById('themeToggle');
        if (themeToggleBtn) {
            themeToggleBtn.addEventListener('click', toggleTheme);
        }

        // ── Default: activate "Última Difusión" tab ──────────────
        const ultimaBtn = document.querySelector('[data-gender="ultima-difusion"]');
        if (ultimaBtn) {
            // Remove active from all, set active on ultima-difusion
            genderNavBtns.forEach(b => b.classList.remove('active'));
            ultimaBtn.classList.add('active');
            
            // Hide catalog, show recently updated
            const controls = document.querySelector('.controls');
            if (controls) controls.style.display = 'none';
            if (catalogGrid) catalogGrid.style.display = 'none';
            if (paginationContainer) paginationContainer.style.display = 'none';
            if (recentlyUpdatedSection) recentlyUpdatedSection.style.display = (activeSection === 'ultima-difusion') ? 'block' : 'none';
            
            // Ensure recientes are loaded
            if (recentlyUpdated.length === 0) {
                fetchRecientes();
            }
        }
    } catch (error) {
        console.error('Error initializing:', error);
        if (loading) loading.innerHTML = '<p style="color:#dc2626;">Hubo un error al cargar el catálogo. Por favor intenta más tarde.</p>';
    }
}

// ─────────────────────────────────────────────────────────────
// 16.  THEME
// ─────────────────────────────────────────────────────────────
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.body.setAttribute('data-theme', savedTheme);
    } else {
        // Opcional: chequear preferencia del sistema
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.body.setAttribute('data-theme', 'dark');
        } else {
            document.body.removeAttribute('data-theme');
        }
    }
}

function toggleTheme() {
    if (document.body.hasAttribute('data-theme')) {
        document.body.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
    } else {
        document.body.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }
}

document.addEventListener('DOMContentLoaded', init);
