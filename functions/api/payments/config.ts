import { jsonResponse, optionsResponse } from '../../_lib/http';
import { publicPaymentsConfig } from '../../_lib/payments';
import { razorpayConfigured, razorpayTestMode } from '../../_lib/razorpay';
import type { Env, PagesFunction } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return jsonResponse(
    request,
    env,
    publicPaymentsConfig(razorpayConfigured(env), razorpayTestMode(env)),
  );
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) =>
  optionsResponse(request, env);
