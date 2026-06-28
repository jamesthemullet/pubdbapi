import type Stripe from "stripe";

type StripeWithInternalRequest = Stripe.Stripe & {
	request: (opts: {
		method: string;
		url: string;
		params?: Record<string, unknown>;
	}) => Promise<Record<string, unknown>>;
};

const stripeRawRequest = async (
	stripe: Stripe.Stripe,
	method: "GET" | "POST",
	path: string,
	params?: Record<string, unknown>,
) => {
	if (typeof (stripe as StripeWithInternalRequest).request === "function") {
		return await (stripe as StripeWithInternalRequest).request({
			method,
			url: path,
			params,
		});
	}

	const base = "https://api.stripe.com";
	const url = base + path;
	let fetchUrl = url;
	let body: string | undefined;
	if (params) {
		const usp = new URLSearchParams();
		for (const [k, v] of Object.entries(params)) {
			usp.append(k, String(v));
		}
		if (method === "GET") fetchUrl = `${url}?${usp.toString()}`;
		else body = usp.toString();
	}

	const fetchFn = globalThis.fetch;
	if (typeof fetchFn !== "function") {
		throw new Error(
			"No fetch available to call Stripe API; please run on Node 18+ or polyfill fetch",
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
	let json: Record<string, unknown>;
	try {
		json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
	} catch (_e) {
		throw new Error(`Stripe returned non-JSON response: ${text}`);
	}

	if (!resp.ok) {
		const err = json.error ?? text;
		throw new Error(`Stripe API error ${resp.status}: ${JSON.stringify(err)}`);
	}

	return json;
};

export default stripeRawRequest;
