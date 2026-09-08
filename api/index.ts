// app.ts artık Hono uygulaması dışa veriyor (Fastify değil). Bu dosya önceden
// Fastify'a özel app.ready()/app.server.emit() çağırıyordu — Hono'da ikisi de
// yok, her istekte çöküyordu. Hono'nun kendi Vercel adaptörü bunu çözüyor.
import { handle } from 'hono/vercel';
import app from '../src/app.js';

export default handle(app);
