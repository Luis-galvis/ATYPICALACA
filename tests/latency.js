// latency.js — Medición de tiempo de respuesta de endpoints (métrica de rendimiento)
const BASE = 'http://localhost:3001';

async function measure(path, opts, n = 5) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const res = await fetch(BASE + path, opts);
    await res.arrayBuffer(); // consumir body completo
    const t1 = performance.now();
    times.push(t1 - t0);
  }
  const sum = times.reduce((a, b) => a + b, 0);
  const avg = sum / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return { path, n, avg: Math.round(avg), min: Math.round(min), max: Math.round(max) };
}

async function main() {
  console.log('Medición de tiempos de respuesta (5 peticiones por endpoint)\n');
  const resultados = [];

  // 1. /api/config (ligero, sin BD)
  const config = await measure('/api/config', {}, 5);
  console.log('GET /api/config        -> promedio', config.avg + ' ms', '(min ' + config.min + ', max ' + config.max + ')');
  resultados.push(config);

  // 2. /api/zapatos (primera vez = MISS, luego HIT por caché 5 min)
  const zapatos1 = await measure('/api/zapatos', {}, 5);
  console.log('GET /api/zapatos       -> promedio', zapatos1.avg + ' ms', '(min ' + zapatos1.min + ', max ' + zapatos1.max + ')');
  resultados.push(zapatos1);

  // 3. /api/cotizar-envio (llamada externa a MiPaquete)
  const cot = await measure('/api/cotizar-envio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciudad: 'Bogotá', cantidad: 1 })
  }, 3);
  console.log('POST /api/cotizar-envio-> promedio', cot.avg + ' ms', '(min ' + cot.min + ', max ' + cot.max + ')');
  resultados.push(cot);

  // 4. /api/recientes
  const rec = await measure('/api/recientes', {}, 3);
  console.log('GET /api/recientes     -> promedio', rec.avg + ' ms', '(min ' + rec.min + ', max ' + rec.max + ')');
  resultados.push(rec);

  require('fs').writeFileSync(require('path').join(__dirname, 'latency_results.json'), JSON.stringify(resultados, null, 2));
  console.log('\n[OK] latency_results.json guardado');
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
