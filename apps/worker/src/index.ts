import { createCatalogueApp } from './catalogue/catalogue-routes';
import { createCoverMediaApp } from './media/cover-routes';
import { createPublicReleaseApp } from './releases/public-release-routes';
import { createCollectiveReviewApp } from './reviews/collective-routes';
import { createFavoriteCollectiveApp } from './reviews/favorite-collective-routes';
import { createWorkerServices, type WorkerRuntime } from './composition';
import { Hono } from 'hono';

const app = new Hono<WorkerRuntime>();
const publicSiteRoutes = new Set(['/', '/library', '/agenda', '/privacy', '/download']);

export function isPublicSiteRoute(pathname: string): boolean {
  return publicSiteRoutes.has(pathname) || (pathname.startsWith('/library/') && pathname.split('/').filter(Boolean).length === 2);
}
app.use('*', async (context, next) => {
  context.set('services', createWorkerServices(context.env));
  await next();
});
app.route('/', createCatalogueApp());
app.route('/', createCollectiveReviewApp());
app.route('/', createFavoriteCollectiveApp());
app.route('/', createCoverMediaApp());
app.route('/', createPublicReleaseApp());
app.notFound((context) => {
  if (context.req.method === 'GET' && isPublicSiteRoute(new URL(context.req.url).pathname)) return context.env.ASSETS.fetch(context.req.raw);
  return context.json({ error: 'not-found' }, 404);
});
app.onError((_error, context) => {
  context.header('Cache-Control', 'no-store');
  context.header('X-Content-Type-Options', 'nosniff');
  return context.json({ error: 'internal-error' }, 500);
});

export default app;
