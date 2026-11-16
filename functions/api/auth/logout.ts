import { buildClearSessionCookie } from '../../_lib/auth';
import { jsonResponse, optionsResponse } from '../../_lib/http';
import type { Env, PagesFunction } from '../../_lib/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  return jsonResponse(request, env, { ok: true }, 200, {
    'Set-Cookie': buildClearSessionCookie(request),
  });
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => optionsResponse(request, env);
