import { authenticateRequest } from '../../_lib/auth';
import { jsonResponse, optionsResponse } from '../../_lib/http';
import { listIntentsForUser, toPublicIntent } from '../../_lib/payments';
import type { Env, PagesFunction } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB || !env.SESSION_SECRET) {
    return jsonResponse(request, env, { error: 'server_misconfigured' }, 500);
  }

  const auth = await authenticateRequest(request, env);
  if (!auth.user) {
    return jsonResponse(request, env, { error: 'unauthenticated' }, 401);
  }

  const rows = await listIntentsForUser(env.DB, auth.user.id);
  return jsonResponse(request, env, {
    intents: rows.map((row) => toPublicIntent(row)),
  });
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) =>
  optionsResponse(request, env);
