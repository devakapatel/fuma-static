import { authenticateRequest } from '../../_lib/auth';
import { jsonResponse, optionsResponse } from '../../_lib/http';
import { toPublicUser } from '../../_lib/users';
import type { Env, PagesFunction } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB || !env.SESSION_SECRET) {
    return jsonResponse(request, env, { user: null }, 500);
  }

  const auth = await authenticateRequest(request, env);
  if (!auth.user) {
    return jsonResponse(request, env, { user: null }, 401);
  }

  return jsonResponse(request, env, { user: toPublicUser(auth.user) });
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => optionsResponse(request, env);
