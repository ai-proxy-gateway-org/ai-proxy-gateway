import type { FastifyInstance } from 'fastify';
import { supabase, createNewClient } from '../services/db.js';

export async function adminRoutes(server: FastifyInstance) {
  // Basit guvenlik: Sadece ADMIN_TOKEN ile erisim
  const checkAdmin = (req: any, reply: any, done: Function) => {
    const token = req.headers['authorization'];
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || token !== `Bearer ${expected}`) {
      return reply.status(401).send({ error: 'Unauthorized admin access' });
    }
    done();
  };

  server.post('/admin/clients', { preHandler: checkAdmin }, async (request, reply) => {
    const { name, environment } = request.body as { name: string; environment?: string };
    if (!name) return reply.status(400).send({ error: 'Name is required' });
    
    const result = await createNewClient(name, environment || 'production');
    if (!result.success) {
      return reply.status(500).send({ error: result.error });
    }
    return result;
  });

  server.patch('/admin/clients/:id/disable', { preHandler: checkAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { error } = await supabase.from('clients').update({ is_active: false }).eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    return { success: true, message: 'Client disabled' };
  });

  server.patch('/admin/clients/:id/enable', { preHandler: checkAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { error } = await supabase.from('clients').update({ is_active: true }).eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    return { success: true, message: 'Client enabled' };
  });
}
