import { authenticateRequest } from '../../_lib/auth';
import { jsonResponse, optionsResponse } from '../../_lib/http';
import { findIntentForUser, toPublicIntent } from '../../_lib/payments';
import type { Env, PagesFunction } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB || !env.SESSION_SECRET) {
    return jsonResponse(request, env, { error: 'server_misconfigured' }, 500);
  }

  const auth = await authenticateRequest(request, env);
  if (!auth.user) {
    return jsonResponse(request, env, { error: 'unauthenticated' }, 401);
  }

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  const row = await findIntentForUser(env.DB, id, auth.user.id);
  if (!row) {
    return jsonResponse(request, env, { error: 'not_found' }, 404);
  }

  return jsonResponse(request, env, { intent: toPublicIntent(row) });
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) =>
  optionsResponse(request, env);
