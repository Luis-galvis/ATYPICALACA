# ATYPICALACA — Catálogo Atypical Store

Tienda en línea de calzado con catálogo en tiempo real, carrito de compras, proceso de pago contra entrega, cotización de envíos y rastreo de pedidos.

## Tecnologías

- **Backend:** Node.js + Express
- **Frontend:** HTML + CSS + JavaScript (sin empaquetador)
- **Base de datos:** Supabase (PostgreSQL + Storage)
- **Integraciones:** API MiPaquete v2 (envíos), WebSocket (stock en tiempo real)

## Requisitos

- Node.js 18 o superior
- Cuenta de Supabase con las tablas configuradas

## Instalación y ejecución

```bash
npm install
node server.js
```

Luego abre en el navegador: http://localhost:3001

## Pruebas de software

```bash
npm test              # pruebas funcionales + seguridad (8 casos)
npm run test:latency  # medición de tiempos de respuesta
```

## Seguridad

Las credenciales se gestionan en el archivo `.env`, que **no** se versiona (ver `.gitignore`). Nunca subas `SUPABASE_SERVICE_KEY` ni `MIPAQUETE_API_KEY` al repositorio.
