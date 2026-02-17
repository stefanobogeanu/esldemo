const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const port = process.env.PORT || 3000;
const debugHttp =
  process.env.DEBUG_HTTP === "true" ||
  (process.env.DEBUG_HTTP !== "false" && process.env.NODE_ENV !== "production");

app.use(cors());
app.use(express.json());

const config = {
  baseUrl: process.env.FINTECHOS_BASE_URL,
  authTokenEndpoint:
    process.env.FINTECHOS_AUTH_TOKEN_ENDPOINT ||
    "/ftosapi/authentication/keycloakToken",
  clientId: process.env.FINTECHOS_CLIENT_ID,
  clientSecret: process.env.FINTECHOS_CLIENT_SECRET,
  userName: process.env.FINTECHOS_USER_NAME,
  password: process.env.FINTECHOS_PASSWORD,
  culture: (process.env.FINTECHOS_CULTURE || "").trim(),
  startEndpoint: process.env.FINTECHOS_START_ENDPOINT,
  loadMetadataEndpoint: process.env.FINTECHOS_LOAD_METADATA_ENDPOINT,
  loadStepEndpoint: process.env.FINTECHOS_LOAD_STEP_ENDPOINT,
  nextEndpoint: process.env.FINTECHOS_NEXT_ENDPOINT,
  previousEndpoint: process.env.FINTECHOS_PREVIOUS_ENDPOINT,
  pfapiBaseUrl:
    process.env.FINTECHOS_PFAPI_BASE_URL || process.env.FINTECHOS_BASE_URL,
  pfapiTokenEndpoint:
    process.env.FINTECHOS_PFAPI_TOKEN_ENDPOINT ||
    process.env.FINTECHOS_AUTH_PFAPI_TOKEN_ENDPOINT ||
    "/pfapi/Authentication/token",
  availableOffersEndpoint: process.env.FINTECHOS_AVAILABLE_OFFERS,
  offerDetailsEndpoint:
    process.env.FINTECHOS_OFFER_DETAILS_ENDPOINT ||
    "/pfapi/api/v1/product/offer",
  defaultJourneyProduct: process.env.DEFAULT_JOURNEY_PRODUCT || "DAO6",
  defaultJourneyClass: process.env.DEFAULT_JOURNEY_CLASS || "Personal",
  defaultProductDependency:
    process.env.DEFAULT_PRODUCT_DEPENDENCY || "SharesAccount",
};

function validateEnv() {
  const commonRequired = [
    "baseUrl",
    "culture",
    "startEndpoint",
    "loadMetadataEndpoint",
    "loadStepEndpoint",
    "nextEndpoint",
    "previousEndpoint",
  ];

  const missing = commonRequired.filter((key) => !config[key]);

  const hasUserPassword = Boolean(config.userName && config.password);
  const hasClientCredentials = Boolean(config.clientId && config.clientSecret);
  if (!hasUserPassword && !hasClientCredentials) {
    missing.push(
      "auth credentials (FINTECHOS_USER_NAME/PASSWORD or FINTECHOS_CLIENT_ID/SECRET)",
    );
  }

  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
}

function withCulture(url) {
  const separator = url.includes("?") ? "" : "?culture=";
  return `${url}${separator}${encodeURIComponent(config.culture)}`;
}

function absoluteUrl(endpoint) {
  return `${config.baseUrl}${endpoint}`;
}

function absolutePfapiUrl(endpoint) {
  return `${config.pfapiBaseUrl}${endpoint}`;
}

function extractToken(payload) {
  if (typeof payload === "string") {
    return payload.replace(/^"|"$/g, "");
  }

  if (payload && typeof payload === "object") {
    return (
      payload.accessToken ||
      payload.access_token ||
      payload.token ||
      payload.jwt ||
      payload.id_token ||
      null
    );
  }

  return null;
}

function debugLog(label, value) {
  if (!debugHttp) {
    return;
  }

  console.log(`[DEBUG] ${label}:`, JSON.stringify(value, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeJwtPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) {
      return null;
    }

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function getBearerTokenFromRequest(req) {
  const header = req.headers.authorization || "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

function debugToken(token, source) {
  const claims = decodeJwtPayload(token);
  // debugLog('Token info', {
  //   source,
  //   azp: claims?.azp || null,
  //   preferred_username: claims?.preferred_username || null,
  //   sub: claims?.sub || null,
  // });
}

async function resolveToken(req) {
  const forwardedToken = getBearerTokenFromRequest(req);
  if (forwardedToken) {
    debugToken(forwardedToken, "forwarded-from-request");
    return forwardedToken;
  }

  const generatedToken = await getToken();
  const source =
    config.userName && config.password
      ? "username-password"
      : "client-credentials";
  debugToken(generatedToken, source);
  return generatedToken;
}

async function getToken() {
  const useUserPassword = Boolean(config.userName && config.password);
  const url = useUserPassword
    ? absoluteUrl(config.authTokenEndpoint)
    : absoluteUrl("/pfapi/Authentication/token");

  const requestBody = useUserPassword
    ? {
        userName: config.userName,
        password: config.password,
      }
    : {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      };

  // debugLog('Auth request', {
  //   mode: useUserPassword ? 'username-password' : 'client-credentials',
  //   url,
  // });

  const response = await axios.post(url, requestBody, {
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  const token = extractToken(response.data);
  if (!token) {
    throw new Error("Could not extract token from authentication response");
  }

  return token;
}

function validatePfapiEnv() {
  const required = [
    "pfapiBaseUrl",
    "pfapiTokenEndpoint",
    "availableOffersEndpoint",
    "offerDetailsEndpoint",
    "clientId",
    "clientSecret",
  ];

  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing PFAPI env vars: ${missing.join(", ")}`);
  }
}

async function getPfapiToken() {
  const url = absolutePfapiUrl(config.pfapiTokenEndpoint);
  debugLog("PFAPI auth request", { url });

  const response = await axios.post(
    url,
    {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    },
    {
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
      },
    },
  );

  const token = extractToken(response.data);
  if (!token) {
    throw new Error(
      "Could not extract token from PFAPI authentication response",
    );
  }

  return token;
}

async function pfapiRequest({ method, url, token, data }) {
  debugLog("PFAPI request", {
    method,
    url,
    data: data || null,
  });

  try {
    const response = await axios({
      method,
      url,
      data,
      headers: {
        accept: "text/plain",
        Authorization: `Bearer ${token}`,
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
    });

    debugLog("PFAPI response", {
      method,
      url,
      status: response.status,
    });

    return response.data;
  } catch (error) {
    debugLog("PFAPI error", {
      method,
      url,
      status: error.response?.status,
      response: error.response?.data || null,
    });
    throw error;
  }
}

async function fintechosRequest({ method, url, token, data }) {
  const requestConfig = {
    method,
    url,
    data,
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
  };

  debugLog("FintechOS request", {
    method,
    url,
    data: data || null,
  });

  try {
    const response = await axios(requestConfig);
    debugLog("FintechOS response", {
      method,
      url,
      status: response.status,
      nextStep: response.data?.nextStep || null,
      externalId: response.data?.externalId || null,
      instanceId: response.data?.instanceId || null,
    });
    return response.data;
  } catch (error) {
    debugLog("FintechOS error", {
      method,
      url,
      status: error.response?.status,
      response: error.response?.data || null,
    });
    throw error;
  }
}

async function loadJourneyMetadata(token) {
  const base = absoluteUrl(config.loadMetadataEndpoint);
  const url = withCulture(base);
  return fintechosRequest({ method: "GET", url, token });
}

async function startJourney(token) {
  const base = absoluteUrl(config.startEndpoint);
  const url = withCulture(base);
  return fintechosRequest({ method: "POST", url, token, data: {} });
}

async function loadStep(token, externalId) {
  const base = `${absoluteUrl(config.loadStepEndpoint)}/${externalId}`;
  const url = withCulture(base);
  return fintechosRequest({ method: "GET", url, token });
}

async function loadStepWithRetry(
  token,
  externalId,
  attempts = 4,
  delayMs = 250,
) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await loadStep(token, externalId);
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const message = error.response?.data?.message || "";
      const canRetry = status === 404 && message;

      if (!canRetry || attempt === attempts) {
        break;
      }

      debugLog("Load step retry", { externalId, attempt, delayMs });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function nextStep(token, externalId, values) {
  const base = `${absoluteUrl(config.nextEndpoint)}/${externalId}`;
  const url = withCulture(base);
  return fintechosRequest({
    method: "POST",
    url,
    token,
    data: { values: values || [] },
  });
}

async function previousStep(token, externalId, values) {
  const base = `${absoluteUrl(config.previousEndpoint)}/${externalId}`;
  const url = withCulture(base);
  return fintechosRequest({
    method: "POST",
    url,
    token,
    data: { values: values || [] },
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/journey/init", async (req, res) => {
  try {
    validateEnv();

    const token = await resolveToken(req);
    const metadata = await loadJourneyMetadata(token);
    const start = await startJourney(token);

    const externalId = start?.externalId;
    if (!externalId) {
      throw new Error("Start Journey did not return externalId");
    }

    const step = await loadStep(token, externalId);

    res.json({
      externalId,
      metadata,
      start,
      step,
    });
  } catch (error) {
    res.status(500).json({
      message: "Init journey failed",
      details: error.response?.data || error.message,
    });
  }
});

app.post("/api/journey/load-step", async (req, res) => {
  try {
    validateEnv();

    const { externalId } = req.body;
    if (!externalId) {
      return res.status(400).json({ message: "externalId is required" });
    }

    const token = await resolveToken(req);
    const step = await loadStep(token, externalId);

    return res.json(step);
  } catch (error) {
    return res.status(500).json({
      message: "Load step failed",
      details: error.response?.data || error.message,
    });
  }
});

app.post("/api/journey/next", async (req, res) => {
  try {
    validateEnv();

    const { externalId, values } = req.body;
    debugLog("API /journey/next input", { externalId, values: values || [] });
    if (!externalId) {
      return res.status(400).json({ message: "externalId is required" });
    }

    const token = await resolveToken(req);
    const nextResponse = await nextStep(token, externalId, values);
    const externalIdForLoad =
      nextResponse?.externalId || nextResponse?.instanceId || externalId;
    const step = await loadStepWithRetry(token, externalIdForLoad);

    return res.json({
      ...nextResponse,
      externalId: externalIdForLoad,
      step,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Next step failed",
      details: error.response?.data || error.message,
    });
  }
});

app.post("/api/journey/previous", async (req, res) => {
  try {
    validateEnv();

    const { externalId, values } = req.body;
    debugLog("API /journey/previous input", {
      externalId,
      values: values || [],
    });
    if (!externalId) {
      return res.status(400).json({ message: "externalId is required" });
    }

    const token = await resolveToken(req);
    const prevResponse = await previousStep(token, externalId, values);
    const externalIdForLoad =
      prevResponse?.externalId || prevResponse?.instanceId || externalId;
    const step = await loadStepWithRetry(token, externalIdForLoad);

    return res.json({
      ...prevResponse,
      externalId: externalIdForLoad,
      step,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Previous step failed",
      details: error.response?.data || error.message,
    });
  }
});

app.post("/api/offers/available", async (req, res) => {
  try {
    validatePfapiEnv();

    const productDependency =
      req.body?.productDependency || config.defaultProductDependency;
    const product = req.body?.product || config.defaultJourneyProduct;
    const className = req.body?.className || config.defaultJourneyClass;

    const token = await getPfapiToken();
    const availableUrl = `${absolutePfapiUrl(config.availableOffersEndpoint)}/available`;

    const availableOffers = await pfapiRequest({
      method: "POST",
      url: availableUrl,
      token,
      data: {
        Input: {
          ProductDependency: productDependency,
        },
        Class: className,
        Product: product,
        IncludeFailedAudienceOffers: false,
      },
    });

    const offersArray = Array.isArray(availableOffers) ? availableOffers : [];
    const details = await Promise.all(
      offersArray.map((offer) =>
        pfapiRequest({
          method: "GET",
          url: `${absolutePfapiUrl(config.offerDetailsEndpoint)}/${offer.offerId}/details`,
          token,
        }),
      ),
    );

    const mappedOffers = offersArray.map((offer, index) => {
      const detail = details[index] || {};
      const offerCards = Array.isArray(detail.offerCards)
        ? detail.offerCards
        : [];

      return {
        offerId: offer.offerId,
        offerName: offer.offerName,
        offerCode: detail.offerCode || null,
        cards: offerCards.map((card) => ({
          cardId: card.cardId,
          cardTitle: card.cardTitle || offer.offerName || "Offer",
          description: card.cardDescription || "",
          benefits: (card.offerCardBenefits || []).map(
            (benefit) => benefit.benefitName,
          ),
        })),
      };
    });

    return res.json({
      offers: mappedOffers,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Load available offers failed",
      details: error.response?.data || error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
