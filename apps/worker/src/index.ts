import { createCatalogueApp } from './catalogue/catalogue-routes';
import { createCoverMediaApp } from './media/cover-routes';
import { createPublicReleaseApp } from './releases/public-release-routes';
import { createCollectiveReviewApp } from './reviews/collective-routes';
import { createWorkerServices, type WorkerRuntime } from './composition';
import { Hono } from 'hono';

const app = new Hono<WorkerRuntime>();
app.use('*', async (context, next) => {
  context.set('services', createWorkerServices(context.env));
  await next();
});
app.route('/', createCatalogueApp());
app.route('/', createCollectiveReviewApp());
app.route('/', createCoverMediaApp());
app.route('/', createPublicReleaseApp());
app.notFound((context) => context.json({ error: 'not-found' }, 404));
app.onError((_error, context) => {
  context.header('Cache-Control', 'no-store');
  context.header('X-Content-Type-Options', 'nosniff');
  return context.json({ error: 'internal-error' }, 500);
});

export default app;
