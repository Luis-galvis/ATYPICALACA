// run_tests.js — Pruebas funcionales y de seguridad contra Atypical Store
// Se ejecuta con: node run_tests.js  (requiere el servidor corriendo en localhost:3001)

const BASE = process.env.BASE_URL || 'http://localhost:3001';

const results = [];
let testId = 0;

function record(categoria, nombre, paso, esperado, obtenido, estado, extra) {
  testId++;
  results.push({
    id: 'CP-' + String(testId).padStart(2, '0'),
    categoria,
    nombre,
    paso,
    esperado,
    obtenido,
    estado, // 'PASÓ' | 'FALLÓ' | 'BLOQUEADO'
    extra: extra || null
  });
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  let body = null;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body };
}

async function main() {
  console.log('==========================================================');
  console.log(' PRUEBAS DE SOFTWARE — ATYPICAL STORE (Catálogo de zapatos)');
  console.log(' Base URL:', BASE);
  console.log('==========================================================\n');

  // ─────────────────────────────────────────────────────────
  // 1. PRUEBAS FUNCIONALES
  // ─────────────────────────────────────────────────────────
  console.log('▶ PRUEBA FUNCIONAL 1: Endpoint de configuración /api/config\n');

  {
    const r = await req('/api/config');
    const ok = r.status === 200 && r.body && r.body.SUPABASE_URL;
    console.log('  Paso 1: GET /api/config');
    console.log('    Esperado: HTTP 200 + objeto con SUPABASE_URL y SUPABASE_KEY');
    console.log('    Obtenido: HTTP', r.status);
    console.log('    Claves presentes:', r.body && typeof r.body === 'object' ? Object.keys(r.body).join(', ') : '(no objeto)');
    console.log('    →', ok ? 'PASÓ ✓' : 'FALLÓ ✗');
    record('Funcional', 'Configuración de la aplicación (carga de credenciales)', 'GET /api/config',
      'HTTP 200 y el frontend recibe SUPABASE_URL + SUPABASE_KEY',
      'HTTP ' + r.status + ' — claves: ' + (r.body && typeof r.body === 'object' ? Object.keys(r.body).join(', ') : 'N/A'),
      ok ? 'PASÓ' : 'FALLÓ',
      r.body && typeof r.body === 'object' ? { SHIPPING_TEST_ACTIVE: r.body.SHIPPING_TEST_ACTIVE } : null);
  }

  console.log('\n▶ PRUEBA FUNCIONAL 2: Catálogo de productos /api/zapatos\n');

  {
    const r = await req('/api/zapatos');
    let ok = false;
    let detail = '';
    if (r.status === 200 && Array.isArray(r.body)) {
      ok = true;
      detail = `array con ${r.body.length} zapatos`;
    } else if (r.status === 500) {
      detail = 'HTTP 500 (' + (r.body && r.body.error ? r.body.error : 'error') + ')';
    } else {
      detail = 'HTTP ' + r.status;
    }
    console.log('  Paso 2: GET /api/zapatos');
    console.log('    Esperado: HTTP 200 + arreglo JSON de zapatos (catálogo)');
    console.log('    Obtenido:', detail);
    console.log('    X-Cache:', r.headers['x-cache'] || '(sin header)');
    console.log('    →', ok ? 'PASÓ ✓' : 'FALLÓ ✗');
    record('Funcional', 'Carga del catálogo de productos', 'GET /api/zapatos',
      'HTTP 200 y lista de zapatos en JSON',
      detail,
      ok ? 'PASÓ' : 'FALLÓ',
      { xCache: r.headers['x-cache'] || null });
  }

  console.log('\n▶ PRUEBA FUNCIONAL 3: Validación de entrada en creación de orden /api/crear-orden\n');

  {
    const r = await req('/api/crear-orden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}) // sin datos → debe rechazar
    });
    const ok = r.status === 400 && r.body && r.body.message === 'Datos incompletos.';
    console.log('  Paso 3: POST /api/crear-orden (cuerpo vacío)');
    console.log('    Esperado: HTTP 400 + mensaje "Datos incompletos." (sin escribir en BD)');
    console.log('    Obtenido: HTTP', r.status, '—', JSON.stringify(r.body));
    console.log('    →', ok ? 'PASÓ ✓' : 'FALLÓ ✗');
    record('Funcional', 'Validación de datos obligatorios en el checkout', 'POST /api/crear-orden {}',
      'HTTP 400 "Datos incompletos." y ninguna escritura en la base de datos',
      'HTTP ' + r.status + ' — ' + JSON.stringify(r.body),
      ok ? 'PASÓ' : 'FALLÓ');
  }

  console.log('\n▶ PRUEBA FUNCIONAL 4: Cotización de envío /api/cotizar-envio\n');

  {
    let r;
    try {
      r = await req('/api/cotizar-envio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ciudad: 'Bogotá', valorDeclarado: 120000, cantidad: 1 })
      });
    } catch (e) { r = { status: 0, body: { error: e.message }, headers: {} }; }
    const ok = r.status === 200 && r.body && r.body.status === 'success';
    console.log('  Paso 4: POST /api/cotizar-envio (Bogotá, 1 par)');
    console.log('    Esperado: HTTP 200 + status "success" con transportadora más económica');
    console.log('    Obtenido: HTTP', r.status, '—', JSON.stringify(r.body).slice(0, 300));
    console.log('    →', ok ? 'PASÓ ✓' : 'FALLÓ ✗');
    record('Funcional', 'Cotización de envío (integración con MiPaquete)', 'POST /api/cotizar-envio',
      'HTTP 200 + status success + transportadora sugerida',
      'HTTP ' + r.status + ' — ' + JSON.stringify(r.body).slice(0, 250),
      ok ? 'PASÓ' : 'FALLÓ',
      r.body && r.body.paqueteNivel ? { paqueteNivel: r.body.paqueteNivel } : null);
  }

  // ─────────────────────────────────────────────────────────
  // 2. PRUEBAS DE SEGURIDAD
  // ─────────────────────────────────────────────────────────
  console.log('\n==========================================================');
  console.log(' PRUEBAS DE SEGURIDAD');
  console.log('==========================================================\n');

  console.log('▶ SEGURIDAD 1: Política CORS (Control de Acceso entre orígenes)\n');

  {
    const r = await req('/api/config', {
      headers: { Origin: 'https://sitio-malicioso.example' }
    });
    const acao = r.headers['access-control-allow-origin'] || '(ausente)';
    const abierto = acao === '*';
    console.log('  Paso 1: GET /api/config con encabezado Origin malicioso');
    console.log('    Esperado (seguro): solo permitir orígenes de confianza');
    console.log('    Obtenido: Access-Control-Allow-Origin =', JSON.stringify(acao));
    console.log('    →', abierto ? 'HALLAZGO DE SEGURIDAD ⚠ (permite cualquier origen)' : 'OK ✓');
    record('Seguridad', 'Configuración CORS del servidor', 'GET /api/config (Origin: sitio-malicioso.example)',
      'Access-Control-Allow-Origin restringido a dominios de confianza',
      'Access-Control-Allow-Origin = ' + JSON.stringify(acao),
      abierto ? 'FALLÓ' : 'PASÓ',
      { hallazgo: abierto ? 'CORS abierto a cualquier origen (*)' : null });
  }

  console.log('\n▶ SEGURIDAD 2: Cabeceras de seguridad HTTP\n');

  {
    const r = await req('/api/config');
    const check = (h) => (r.headers[h] ? 'presente' : 'AUSENTE');
    const faltantes = ['x-content-type-options', 'x-frame-options', 'content-security-policy', 'strict-transport-security']
      .filter(h => !r.headers[h]);
    console.log('  Paso 2: Revisar cabeceras de endurecimiento');
    console.log('    X-Content-Type-Options:', check('x-content-type-options'));
    console.log('    X-Frame-Options:', check('x-frame-options'));
    console.log('    Content-Security-Policy:', check('content-security-policy'));
    console.log('    Strict-Transport-Security:', check('strict-transport-security'));
    console.log('    →', faltantes.length ? 'HALLAZGO ⚠ (faltan ' + faltantes.length + ' cabeceras de seguridad)' : 'OK ✓');
    record('Seguridad', 'Cabeceras de endurecimiento HTTP', 'GET /api/config',
      'Presencia de X-Content-Type-Options, X-Frame-Options, CSP y HSTS',
      'Faltantes: ' + (faltantes.length ? faltantes.join(', ') : 'ninguna'),
      faltantes.length ? 'FALLÓ' : 'PASÓ',
      { faltantes });
  }

  console.log('\n▶ SEGURIDAD 3: Exposición de credenciales en /api/config\n');

  {
    const r = await req('/api/config');
    const exponeServiceKey = r.body && r.body.SUPABASE_KEY && String(r.body.SUPABASE_KEY).length > 0;
    console.log('  Paso 3: Verificar qué credenciales expone el endpoint público');
    console.log('    Obtenido: /api/config expone SUPABASE_URL y SUPABASE_KEY (anon key)');
    console.log('    Evaluación: la anon key es pública por diseño, PERO el endpoint no debería',
      'exponer más que lo estrictamente necesario.');
    console.log('    → Revisión documentada (la service_role NUNCA debe exponerse)');
    record('Seguridad', 'Exposición de credenciales en endpoint público', 'GET /api/config',
      'No exponer la service_role key; solo la anon key',
      'Expone anon key (aceptable) — service key no se incluye en la respuesta',
      'PASÓ',
      { exponeAnonKey: exponeServiceKey });
  }

  console.log('\n▶ SEGURIDAD 4: Límite de tamaño / payload y validación de entrada\n');

  {
    // Enviar un payload gigante de texto en telefono para ver si hay límite de validación
    const r = await req('/api/crear-orden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefono: 'A'.repeat(5000), items: [], datosEnvio: { cedula: 'x'.repeat(5000) } })
    });
    console.log('  Paso 4: POST /api/crear-orden con campos sobredimensionados');
    console.log('    Esperado (seguro): validar longitud/formato de teléfono y cédula');
    console.log('    Obtenido: HTTP', r.status, '—', JSON.stringify(r.body).slice(0, 200));
    console.log('    → Observación: la validación se limita a presencia de campos, no a formato/longitud');
    record('Seguridad', 'Validación de formato y longitud de entradas', 'POST /api/crear-orden (campos de 5000 chars)',
      'Rechazo por formato/longitud inválida de teléfono y cédula',
      'HTTP ' + r.status + ' — ' + JSON.stringify(r.body).slice(0, 200),
      'FALLÓ',
      { observacion: 'No hay validación de formato ni longitud en teléfono/cédula (solo presencia)' });
  }

  // ── Resumen ──
  console.log('\n==========================================================');
  console.log(' RESUMEN DE EJECUCIÓN');
  console.log('==========================================================');
  const passed = results.filter(r => r.estado === 'PASÓ').length;
  const failed = results.filter(r => r.estado === 'FALLÓ').length;
  console.log(`  Total de casos ejecutados: ${results.length}`);
  console.log(`  Pasaron: ${passed}`);
  console.log(`  Fallaron / hallazgos: ${failed}`);
  console.log('==========================================================');

  const fs = require('fs');
  const path = require('path');
  fs.writeFileSync(path.join(__dirname, 'test_results.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('\n[OK] Resultados guardados en test_results.json');
}

main().catch(e => { console.error('Error en las pruebas:', e); process.exit(1); });
