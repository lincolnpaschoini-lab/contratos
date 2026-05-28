import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import expressEjsLayouts from 'express-ejs-layouts';
import compression from 'compression';

import { env } from './config/env';
import { logger } from './config/logger';
import { errorMiddleware } from './shared/middlewares/error.middleware';
import { correlationIdMiddleware } from './shared/middlewares/correlation-id.middleware';
import { flashMiddleware } from './shared/middlewares/flash.middleware';
import { authContextMiddleware } from './shared/middlewares/auth.middleware';
import { defaultRateLimit } from './shared/middlewares/rate-limit.middleware';
import {
  formatDate, formatDateTime, formatRelative, formatCurrency,
  STEP_LABELS, STEP_STATUS_LABELS, CONTRACT_STATUS_LABELS,
  STEP_STATUS_CSS, CONTRACT_STATUS_CSS, stepOrder, STEP_NAMES_ORDERED,
} from './shared/utils/format';

import { authRoutes } from './modules/auth/auth.routes';
import { contractRoutes } from './modules/contracts/contracts.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { userRoutes } from './modules/users/users.routes';
import { settingsRoutes } from './modules/settings/settings.routes';
import { pipedriveRoutes } from './modules/integrations/pipedrive/pipedrive.routes';
import { clicksignRoutes } from './modules/integrations/clicksign/clicksign.routes';
import { webhookEventRoutes } from './modules/webhooks/webhooks.routes';

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'https:'],
    },
  },
}));

app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser(env.COOKIE_SECRET));

app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.path === '/health',
  }),
);

app.use(correlationIdMiddleware);
app.use(flashMiddleware);

// EJS
app.set('view engine', 'ejs');
// process.cwd() = /app tanto em dev quanto em produção no Docker
app.set('views', path.join(process.cwd(), 'views'));
app.use(expressEjsLayouts);
app.set('layout', 'layouts/main');

// Expõe helpers de formatação para todas as views
app.use((req, res, next) => {
  res.locals.h = {
    formatDate, formatDateTime, formatRelative, formatCurrency,
    STEP_LABELS, STEP_STATUS_LABELS, CONTRACT_STATUS_LABELS,
    STEP_STATUS_CSS, CONTRACT_STATUS_CSS, stepOrder, STEP_NAMES_ORDERED,
  };
  next();
});

app.use(express.static(path.join(process.cwd(), 'public')));
app.use(authContextMiddleware);

// Healthcheck (sem rate limit)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: env.NODE_ENV });
});

app.use(defaultRateLimit);

// Rotas
app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/contracts', contractRoutes);
app.use('/users', userRoutes);
app.use('/settings', settingsRoutes);
app.use('/webhook-events', webhookEventRoutes);
app.use('/integrations/pipedrive', pipedriveRoutes);
app.use('/integrations/clicksign', clicksignRoutes);

app.get('/', (req, res) => res.redirect('/dashboard'));

app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Página não encontrada', layout: 'layouts/main' });
});

app.use(errorMiddleware);

export { app };
