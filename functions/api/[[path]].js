import app from "../_lib/app.js";

export async function onRequest(context) {
  return app.fetch(context.request, context.env, context);
}
