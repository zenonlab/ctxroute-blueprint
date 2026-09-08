import { favoriteCollectiveCommandSchema, favoriteOwnerCredentialsSchema, favoriteOwnerRegistrationSchema, favoritePairRedemptionSchema } from '@tobirink/application';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { WorkerRuntime } from '../composition';

export function createFavoriteCollectiveApp() {
  const app = new Hono<WorkerRuntime>();
  app.use('/v2/favorites/*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    context.header('X-Content-Type-Options', 'nosniff');
    // These owner APIs do not accept browser sessions or cross-origin web forms.
    if (context.req.header('Cookie') || context.req.header('Sec-Fetch-Site') === 'cross-site') return context.json({ error: 'extension-authentication-required' }, 403);
    await next();
  });
  app.use('/v2/favorites/*', bodyLimit({ maxSize: 65536, onError: (context) => context.json({ error: 'body-too-large' }, 413) }));
  app.get('/v2/favorites/rules', async (context) => context.json(await context.get('services').favoriteCollective.readRules()));
  app.post('/v2/favorites/owners', async (context) => {
    const parsed = favoriteOwnerRegistrationSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: 'invalid-registration' }, 400);
    const accepted = await context.get('services').favoriteCollective.register(parsed.data);
    return context.json({ accepted }, accepted ? 201 : 403);
  });
  app.post('/v2/favorites/pairings/redeem', async (context) => {
    const parsed = favoritePairRedemptionSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: 'invalid-pairing' }, 400);
    const accepted = await context.get('services').favoriteCollective.redeem(parsed.data);
    return context.json({ accepted }, accepted ? 201 : 403);
  });
  app.post('/v2/favorites/batches', async (context) => {
    const authorization = context.req.header('Authorization');
    const credentials = favoriteOwnerCredentialsSchema.safeParse({
      ownerId: context.req.header('X-Tobirink-Owner'), installationId: context.req.header('X-Tobirink-Installation'),
      token: authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined,
    });
    if (!credentials.success) return context.json({ error: 'unauthorized' }, 401);
    const command = favoriteCollectiveCommandSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!command.success) return context.json({ error: 'invalid-batch' }, 400);
    const services = context.get('services');
    const response = await services.favoriteCollective.execute(credentials.data, command.data, services.collective.dailyQuota);
    if (response.kind === 'ACCEPTED') return context.json(response.receipt);
    if (response.kind === 'REPLAY') return context.json({ error: 'replayed-nonce' }, 409);
    if (response.kind === 'QUOTA_EXCEEDED') return context.json({ error: 'daily-quota-exceeded' }, 429);
    return context.json({ error: 'unauthorized' }, 403);
  });
  return app;
}
