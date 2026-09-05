import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  contributeCollectiveAssociation,
  createCollectiveConsent,
  revokeCollectiveConsent,
} from '@tobirink/application';
import {
  collectiveAssociationSchema,
  collectiveConsentCredentialsSchema,
  collectiveConsentIdSchema,
  collectiveSecretSchema,
  createCollectiveConsentSchema,
} from '@tobirink/contracts';
import type { WorkerRuntime, WorkerServices } from '../composition';

function authorizationToken(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  const parsed = collectiveSecretSchema.safeParse(header.slice('Bearer '.length));
  return parsed.success ? parsed.data : undefined;
}

type CollectiveServices = Pick<WorkerServices, 'collective' | 'policy'>;

function routeServices(context: { get(key: 'services'): WorkerServices }, injected?: CollectiveServices): CollectiveServices {
  return injected ?? context.get('services');
}

export function createCollectiveReviewApp(injected?: CollectiveServices) {
  const app = new Hono<WorkerRuntime>();

  app.use('*', async (context, next) => {
    await next();
    context.header('Cache-Control', 'no-store');
    context.header('X-Content-Type-Options', 'nosniff');
  });

  app.use('/v1/collective/*', (context, next) => bodyLimit({
    maxSize: routeServices(context, injected).policy.collective.maximumBodyBytes,
    onError: (limitedContext) => limitedContext.json({ error: 'body-too-large' }, 413),
  })(context, next));

  app.post('/v1/collective/consents', async (context) => {
    const parsed = createCollectiveConsentSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: 'invalid-consent' }, 400);
    const services = routeServices(context, injected);
    const credentials = collectiveConsentCredentialsSchema.parse(await createCollectiveConsent(services.collective));
    return context.json(credentials, 201);
  });

  app.post('/v1/collective/associations', async (context) => {
    const writeToken = authorizationToken(context.req.header('Authorization'));
    if (!writeToken) return context.json({ error: 'unauthorized' }, 401);
    const parsed = collectiveAssociationSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: 'invalid-association' }, 400);
    const services = routeServices(context, injected);
    const result = await contributeCollectiveAssociation(
      services.collective,
      { ...parsed.data, writeToken },
      services.collective.dailyQuota,
    );
    if (result === 'accepted') return context.json({ accepted: true }, 201);
    if (result === 'duplicate') return context.json({ error: 'replayed-nonce' }, 409);
    if (result === 'quota-exceeded') return context.json({ error: 'daily-quota-exceeded' }, 429);
    return context.json({ error: 'consent-unavailable' }, 403);
  });

  app.post('/v1/collective/consents/:consentId/revoke', async (context) => {
    const consentId = collectiveConsentIdSchema.safeParse(context.req.param('consentId'));
    const revokeToken = authorizationToken(context.req.header('Authorization'));
    if (!consentId.success || !revokeToken) return context.json({ error: 'unauthorized' }, 401);
    const revoked = await revokeCollectiveConsent(routeServices(context, injected).collective, consentId.data, revokeToken);
    return revoked ? context.json({ revoked: true }) : context.json({ error: 'consent-unavailable' }, 403);
  });

  app.notFound((context) => context.json({ error: 'not-found' }, 404));
  app.onError((_error, context) => context.json({ error: 'internal-error' }, 500));
  return app;
}
