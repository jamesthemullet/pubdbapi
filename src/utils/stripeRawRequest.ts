import Stripe from "stripe";

const stripeRawRequest = async (
  stripe: Stripe,
  method: "GET" | "POST",
  path: string,
  params?: Record<string, any>
) => {
  if (typeof (stripe as any).request === "function") {
    return await (stripe as any).request({ method, url: path, params });
  }

  const base = "https://api.stripe.com";
  const url = base + path;
  let fetchUrl = url;
  let body: string | undefined = undefined;
  if (params) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      usp.append(k, String(v));
    }
    if (method === "GET") fetchUrl = `${url}?${usp.toString()}`;
    else body = usp.toString();
  }

  const fetchFn: typeof fetch = (globalThis as any).fetch;
  if (typeof fetchFn !== "function") {
    throw new Error(
      "No fetch available to call Stripe API; please run on Node 18+ or polyfill fetch"
    );
  }

  const resp = await fetchFn(fetchUrl, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": process.env.STRIPE_API_VERSION || "2024-06-20",
    },
    body,
  });

  const text = await resp.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`Stripe returned non-JSON response: ${text}`);
  }

  if (!resp.ok) {
    const err = json && json.error ? json.error : text;
    throw new Error(`Stripe API error ${resp.status}: ${JSON.stringify(err)}`);
  }

  return json;
};

export default stripeRawRequest;
