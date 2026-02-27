import { useEffect, useMemo, useRef, useState } from "react";

const EXTERNAL_ID_STORAGE_KEY = "journeyExternalId";
const SELECTED_OFFER_STORAGE_KEY = "selectedOfferId";
const OFFER_VIEW_STEP_STORAGE_KEY = "offerViewStep";
const ESIGN_CALLBACK_PATH = "/esign/callback";
const PERSONA_SCRIPT_URL = "https://cdn.withpersona.com/dist/persona-v5.6.0.js";
const STRIPE_SCRIPT_URL = "https://js.stripe.com/v3/";
const DEFAULT_PHONE_COUNTRIES = [
  { code: "+1", label: "US", flag: "🇺🇸" },
  { code: "+40", label: "RO", flag: "🇷🇴" },
  { code: "+44", label: "UK", flag: "🇬🇧" },
];

function getPersonaGlobal() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.Persona || null;
}

function ensurePersonaLibrary() {
  const existingPersona = getPersonaGlobal();
  if (existingPersona) {
    return Promise.resolve(existingPersona);
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.getElementById("persona-js-sdk");
    if (existingScript) {
      existingScript.addEventListener("load", () => {
        const persona = getPersonaGlobal();
        if (persona) {
          resolve(persona);
          return;
        }
        reject(new Error("Persona library loaded but global object was not found."));
      });
      existingScript.addEventListener("error", () => {
        reject(new Error("Failed to load Persona library."));
      });
      return;
    }

    const script = document.createElement("script");
    script.id = "persona-js-sdk";
    script.src = PERSONA_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const persona = getPersonaGlobal();
      if (persona) {
        resolve(persona);
        return;
      }
      reject(new Error("Persona library loaded but global object was not found."));
    };
    script.onerror = () => {
      reject(new Error("Failed to load Persona library."));
    };

    document.head.appendChild(script);
  });
}

function ensureStripeLibrary() {
  if (typeof window !== "undefined" && typeof window.Stripe === "function") {
    return Promise.resolve(window.Stripe);
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.getElementById("stripe-js-sdk");
    if (existingScript) {
      existingScript.addEventListener("load", () => {
        if (typeof window.Stripe === "function") {
          resolve(window.Stripe);
          return;
        }
        reject(new Error("Stripe library loaded but Stripe global was not found."));
      });
      existingScript.addEventListener("error", () => {
        reject(new Error("Failed to load Stripe library."));
      });
      return;
    }

    const script = document.createElement("script");
    script.id = "stripe-js-sdk";
    script.src = STRIPE_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (typeof window.Stripe === "function") {
        resolve(window.Stripe);
        return;
      }
      reject(new Error("Stripe library loaded but Stripe global was not found."));
    };
    script.onerror = () => {
      reject(new Error("Failed to load Stripe library."));
    };

    document.head.appendChild(script);
  });
}

function normalizeFieldType(fieldType) {
  return String(fieldType || "text")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeRequiredLevel(requiredLevel) {
  const level = Number(requiredLevel);
  return Number.isFinite(level) ? level : 0;
}

function defaultFieldValue(field) {
  return normalizeFieldType(field?.type) === "bool" ? false : "";
}

function formatDateInputValue(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function formatDateTimeLocalInputValue(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
  ) {
    return value.slice(0, 16);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 16);
}

function coerceInitialFieldValue(field) {
  const rawValue = field?.value;
  const type = normalizeFieldType(field?.type);

  if (rawValue === null || rawValue === undefined) {
    return defaultFieldValue(field);
  }

  if (type === "bool") {
    if (typeof rawValue === "boolean") {
      return rawValue;
    }
    if (typeof rawValue === "string") {
      const lowered = rawValue.toLowerCase();
      return lowered === "true" || lowered === "1";
    }
    return Boolean(rawValue);
  }

  if (type === "wholenumber") {
    const parsed = Number.parseInt(rawValue, 10);
    return Number.isNaN(parsed) ? "" : parsed;
  }

  if (type === "numeric" || type === "money") {
    const parsed = Number(rawValue);
    return Number.isNaN(parsed) ? "" : parsed;
  }

  if (type === "date" || type === "invariantdate") {
    return formatDateInputValue(rawValue);
  }

  if (type === "datetime") {
    return formatDateTimeLocalInputValue(rawValue);
  }

  return rawValue;
}

function coerceFieldValueForChange(field, nextValue) {
  const type = normalizeFieldType(field?.type);

  if (type === "bool") {
    return Boolean(nextValue);
  }

  if (type === "wholenumber") {
    if (nextValue === "") {
      return "";
    }
    const parsed = Number.parseInt(nextValue, 10);
    return Number.isNaN(parsed) ? "" : parsed;
  }

  if (type === "numeric" || type === "money") {
    if (nextValue === "") {
      return "";
    }
    const parsed = Number(nextValue);
    return Number.isNaN(parsed) ? "" : parsed;
  }

  return nextValue;
}

function mapAvailableOffersToCards(availableOffers) {
  const offers = Array.isArray(availableOffers) ? availableOffers : [];
  const cards = [];

  for (const offer of offers) {
    const offerCard = offer?.offerCard || {};
    cards.push({
      offerId: offer?.offerId || "",
      offerCode: offer?.offerCode || "",
      cardId: offerCard?.cardId || offer?.offerId || "",
      cardTitle: offerCard?.cardTitle || offer?.offerName || "Offer",
      description: offerCard?.cardDescription || "",
      benefits: Array.isArray(offerCard?.offerCardBenefits)
        ? offerCard.offerCardBenefits
            .map((benefit) => benefit?.benefitName)
            .filter(Boolean)
        : [],
    });
  }

  return cards;
}

function getFieldUi(field) {
  if (field?.ui && typeof field.ui === "object" && !Array.isArray(field.ui)) {
    return field.ui;
  }
  return {};
}

function applyNamedMask(value, maskName) {
  if (typeof value !== "string") {
    return value;
  }

  const normalizedMask = String(maskName || "")
    .trim()
    .toLowerCase();
  if (normalizedMask !== "ssn") {
    return value;
  }

  const digits = value.replace(/\D/g, "").slice(0, 9);
  if (digits.length <= 3) {
    return digits;
  }
  if (digits.length <= 5) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function normalizePhoneCountry(country) {
  if (!country) {
    return null;
  }

  if (typeof country === "string") {
    return { code: country, label: country, flag: "" };
  }

  if (typeof country === "object" && typeof country.code === "string") {
    return {
      code: country.code,
      label: country.label || country.code,
      flag: country.flag || "",
    };
  }

  return null;
}

function resolvePhoneCountries(field) {
  const ui = getFieldUi(field);
  const source = Array.isArray(ui.phoneCountries)
    ? ui.phoneCountries
    : DEFAULT_PHONE_COUNTRIES;
  const normalized = source.map(normalizePhoneCountry).filter(Boolean);
  return normalized.length > 0 ? normalized : DEFAULT_PHONE_COUNTRIES;
}

function resolveDefaultCountryCode(field, countries) {
  const ui = getFieldUi(field);
  const defaultCode = String(ui.defaultCountryCode || "").trim();
  if (defaultCode && countries.some((country) => country.code === defaultCode)) {
    return defaultCode;
  }
  return countries[0]?.code || "+1";
}

function splitPhoneValue(fullValue, countries, fallbackCode) {
  const value = String(fullValue || "").trim();
  if (!value) {
    return {
      countryCode: fallbackCode,
      localNumber: "",
    };
  }

  const sortedCountries = [...countries].sort(
    (left, right) => right.code.length - left.code.length,
  );
  for (const country of sortedCountries) {
    if (value.startsWith(country.code)) {
      return {
        countryCode: country.code,
        localNumber: value.slice(country.code.length).trim(),
      };
    }
  }

  return {
    countryCode: fallbackCode,
    localNumber: value,
  };
}

function buildPhoneValue(countryCode, localNumber) {
  const normalizedCode = String(countryCode || "")
    .replace(/[^\d+]/g, "")
    .trim();
  const normalizedLocalNumber = String(localNumber || "")
    .replace(/\D/g, "")
    .trim();
  if (!normalizedCode) {
    return normalizedLocalNumber;
  }
  if (!normalizedLocalNumber) {
    return normalizedCode;
  }
  return `${normalizedCode}${normalizedLocalNumber}`;
}

function formatFieldValueForSubmit(field, rawValue) {
  const ui = getFieldUi(field);
  const value = rawValue ?? defaultFieldValue(field);

  if (ui.phoneCountrySelect) {
    const rawString = String(value || "");
    const hasPlusPrefix = rawString.trim().startsWith("+");
    const digits = rawString.replace(/\D/g, "");
    if (!digits) {
      return "";
    }
    return `${hasPlusPrefix ? "+" : ""}${digits}`;
  }

  if (String(ui.mask || "").toLowerCase() === "ssn") {
    return String(value || "").replace(/\D/g, "");
  }

  return value;
}

function buildSelectedOffersPayload(availableOffers, selectedOfferId) {
  const offers = Array.isArray(availableOffers) ? availableOffers : [];
  const selectedOffer = offers.find((offer) => offer?.offerId === selectedOfferId);
  if (!selectedOffer) {
    return [];
  }

  return [
    {
      offerId: selectedOffer.offerId || "",
      productsCategory: Array.isArray(selectedOffer.productsCategory)
        ? selectedOffer.productsCategory
        : [],
      offerName: selectedOffer.offerName || "",
      offerProducts: Array.isArray(selectedOffer.offerProducts)
        ? selectedOffer.offerProducts
        : [],
    },
  ];
}

function extractApiErrorMessage(payload, fallbackMessage) {
  const details = payload?.details;
  if (typeof details === "string" && details.trim()) {
    return details;
  }

  if (details && typeof details === "object") {
    if (typeof details.message === "string" && details.message.trim()) {
      return details.message;
    }
    if (typeof details.title === "string" && details.title.trim()) {
      return details.title;
    }
    try {
      return JSON.stringify(details);
    } catch (_error) {
      return fallbackMessage;
    }
  }

  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message;
  }

  return fallbackMessage;
}

function buildValuesFromStep(step, formValues) {
  const fields = step?.fields || [];
  return fields.map((field) => ({
    attribute: field.name,
    value: formatFieldValueForSubmit(field, formValues[field.name]),
  }));
}

function parseSelectedOffersValue(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue === "string") {
    try {
      const parsed = JSON.parse(rawValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  return [];
}

function extractSummarySelectedOffers(viewItemPayload) {
  const fields = Array.isArray(viewItemPayload?.fields) ? viewItemPayload.fields : [];
  const selectedOfferField = fields.find((field) => field?.name === "selectedOfferIds");
  if (!selectedOfferField) {
    return [];
  }

  const offers = parseSelectedOffersValue(selectedOfferField.value);
  return offers.filter((offer) => offer && typeof offer === "object");
}

function App() {
  const currentPath = window.location.pathname || "/";
  const isEsignCallbackPage = currentPath === ESIGN_CALLBACK_PATH;
  const isEmbeddedInIframe = (() => {
    try {
      return window.self !== window.top;
    } catch (_error) {
      return true;
    }
  })();

  const [externalId, setExternalId] = useState("");
  const [metadata, setMetadata] = useState(null);
  const [step, setStep] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [offerCards, setOfferCards] = useState([]);
  const [summarySelectedOffers, setSummarySelectedOffers] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [stripeSubmitting, setStripeSubmitting] = useState(false);
  const [phoneCountryByField, setPhoneCountryByField] = useState({});
  const [selectedOfferId, setSelectedOfferId] = useState(
    () => sessionStorage.getItem(SELECTED_OFFER_STORAGE_KEY) || "",
  );
  const actionInFlightRef = useRef(false);
  const initializedRef = useRef(false);
  const actionStepAutoAdvanceRef = useRef("");
  const esignAutoAdvanceRef = useRef("");
  const esignIframeRef = useRef(null);
  const personaIframeRef = useRef(null);
  const personaInitRef = useRef("");
  const personaAutoAdvanceRef = useRef("");
  const stripeMountRef = useRef(null);
  const stripeStateRef = useRef({
    stripe: null,
    elements: null,
    clientSecret: null,
  });
  const stripeInitRef = useRef("");
  const stripeAutoAdvanceRef = useRef("");

  async function startNewJourney() {
    setLoading(true);
    setError("");
    setOfferCards([]);
    setSummarySelectedOffers([]);
    setSummaryLoading(false);
    setSummaryError("");
    setStripeSubmitting(false);
    setSelectedOfferId("");
    setPhoneCountryByField({});
    setFormValues({});
    actionStepAutoAdvanceRef.current = "";
    personaInitRef.current = "";
    personaAutoAdvanceRef.current = "";
    stripeInitRef.current = "";
    stripeAutoAdvanceRef.current = "";
    stripeStateRef.current = {
      stripe: null,
      elements: null,
      clientSecret: null,
    };

    sessionStorage.removeItem(EXTERNAL_ID_STORAGE_KEY);
    sessionStorage.removeItem(SELECTED_OFFER_STORAGE_KEY);
    sessionStorage.removeItem(OFFER_VIEW_STEP_STORAGE_KEY);

    const response = await fetch("/api/journey/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(extractApiErrorMessage(payload, "Restart journey failed"));
    }

    setExternalId(payload.externalId);
    setMetadata(payload.metadata);
    setStep(payload.step);
    sessionStorage.setItem(EXTERNAL_ID_STORAGE_KEY, payload.externalId);
  }

  useEffect(() => {
    if (isEsignCallbackPage) {
      return;
    }

    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;

    async function initJourney() {
      try {
        setLoading(true);
        setError("");

        const storedExternalId = sessionStorage.getItem(
          EXTERNAL_ID_STORAGE_KEY,
        );
        if (storedExternalId) {
          const loadResponse = await fetch("/api/journey/load-step", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ externalId: storedExternalId }),
          });

          const loadPayload = await loadResponse.json();
          if (loadResponse.ok) {
            setExternalId(storedExternalId);
            setStep(loadPayload);
            return;
          }

          sessionStorage.removeItem(EXTERNAL_ID_STORAGE_KEY);
        }

        await startNewJourney();
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }

    initJourney();
  }, [isEsignCallbackPage]);

  useEffect(() => {
    if (!step?.fields?.length) {
      return;
    }

    setFormValues((previous) => {
      const next = { ...previous };
      for (const field of step.fields) {
        if (next[field.name] === undefined) {
          next[field.name] = coerceInitialFieldValue(field);
        }
      }
      return next;
    });
  }, [step]);

  useEffect(() => {
    if (!step?.fields?.length) {
      return;
    }

    setPhoneCountryByField((previous) => {
      const next = { ...previous };
      for (const field of step.fields) {
        const ui = getFieldUi(field);
        if (!ui.phoneCountrySelect) {
          continue;
        }

        const countries = resolvePhoneCountries(field);
        const fallbackCode = resolveDefaultCountryCode(field, countries);
        const parts = splitPhoneValue(formValues[field.name], countries, fallbackCode);
        next[field.name] = parts.countryCode;
      }
      return next;
    });
  }, [step, formValues]);

  const showNext = Boolean(step?.properties?.nextButton?.show);
  const showPrevious =
    Boolean(step?.properties?.previousButton?.show) ||
    step?.isFirstStep === false;
  const isActionStep =
    String(step?.journeyStepType || "").toLowerCase() === "action";

  const stepTitle = useMemo(() => {
    if (!step?.journeyStep) return "Step";
    return step.journeyStep.split("-")[0];
  }, [step]);
  const isDocumentsSignedStep = useMemo(() => {
    const stepName = String(step?.journeyStep || "").toLowerCase();
    return stepName.includes("documents") && stepName.includes("signed");
  }, [step]);
  const isEidvCompletedStep = useMemo(() => {
    const stepName = String(step?.journeyStep || "").toLowerCase();
    return stepName.includes("verification") && stepName.includes("success");
  }, [step]);
  const isSummaryStep = useMemo(() => {
    const stepName = String(step?.journeyStep || "").toLowerCase();
    return stepName.includes("summary");
  }, [step]);
  const stepAvailableOffers = useMemo(
    () => (Array.isArray(step?.availableOffers) ? step.availableOffers : []),
    [step],
  );
  const stepEsignUrl = useMemo(() => {
    if (typeof step?.esignUrl !== "string") {
      return "";
    }
    return step.esignUrl.trim();
  }, [step]);
  const stepPersonaResponse = useMemo(() => {
    if (
      step?.personaResponse &&
      typeof step.personaResponse === "object" &&
      !Array.isArray(step.personaResponse)
    ) {
      return step.personaResponse;
    }
    return null;
  }, [step]);
  const stepStripePaymentDetails = useMemo(() => {
    if (
      step?.stripePaymentDetails &&
      typeof step.stripePaymentDetails === "object" &&
      !Array.isArray(step.stripePaymentDetails)
    ) {
      return step.stripePaymentDetails;
    }
    return null;
  }, [step]);
  const isESignStep = Boolean(stepEsignUrl);
  const isPersonaStep = Boolean(stepPersonaResponse?.id);
  const isStripeStep = Boolean(stepStripePaymentDetails?.stripeToken);
  const isOffersStep = stepAvailableOffers.length > 0;

  useEffect(() => {
    const journeyStep = String(step?.journeyStep || "");
    if (!journeyStep) {
      return;
    }

    if (journeyStep.startsWith("Offer-")) {
      sessionStorage.setItem(OFFER_VIEW_STEP_STORAGE_KEY, journeyStep);
    }
  }, [step]);

  useEffect(() => {
    if (isOffersStep) {
      const cards = mapAvailableOffersToCards(stepAvailableOffers);
      setOfferCards(cards);

      const storedSelectedOfferId =
        sessionStorage.getItem(SELECTED_OFFER_STORAGE_KEY) || "";
      const hasStoredOffer = cards.some(
        (card) => card.offerId === storedSelectedOfferId,
      );
      if (hasStoredOffer) {
        setSelectedOfferId(storedSelectedOfferId);
      } else {
        setSelectedOfferId("");
        sessionStorage.removeItem(SELECTED_OFFER_STORAGE_KEY);
      }
    } else {
      setOfferCards([]);
      setSelectedOfferId("");
      sessionStorage.removeItem(SELECTED_OFFER_STORAGE_KEY);
    }
  }, [isOffersStep, stepAvailableOffers]);

  useEffect(() => {
    if (!isActionStep) {
      actionStepAutoAdvanceRef.current = "";
      return;
    }

    const stepKey = `${step?.journeyStep || ""}|${externalId || ""}`;
    if (actionStepAutoAdvanceRef.current === stepKey) {
      return;
    }

    actionStepAutoAdvanceRef.current = stepKey;
    go("next", { forceEmptyValues: true, skipOfferValidation: true });
  }, [isActionStep, step?.journeyStep, externalId]);

  useEffect(() => {
    if (!isEsignCallbackPage || !isEmbeddedInIframe) {
      return;
    }

    window.parent.postMessage(
      {
        type: "ESIGN_COMPLETED",
        path: window.location.pathname,
        search: window.location.search,
      },
      window.location.origin,
    );
  }, [isEsignCallbackPage, isEmbeddedInIframe]);

  useEffect(() => {
    if (!isESignStep) {
      return;
    }

    function onMessage(event) {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event?.data?.type !== "ESIGN_COMPLETED") {
        return;
      }

      const stepKey = `${step?.journeyStep || ""}|${externalId || ""}`;
      if (esignAutoAdvanceRef.current === stepKey) {
        return;
      }

      esignAutoAdvanceRef.current = stepKey;
      go("next", { forceEmptyValues: true, skipOfferValidation: true });
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isESignStep, step?.journeyStep, externalId]);

  useEffect(() => {
    if (!isPersonaStep) {
      personaInitRef.current = "";
      personaAutoAdvanceRef.current = "";
      return;
    }

    const stepKey = `${step?.journeyStep || ""}|${externalId || ""}`;
    if (personaInitRef.current === stepKey) {
      return;
    }

    personaInitRef.current = stepKey;
    let cancelled = false;

    async function setupPersonaInline() {
      try {
        const Persona = await ensurePersonaLibrary();
        if (cancelled || !personaIframeRef.current) {
          return;
        }

        const randomId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const containerId = `persona-widget-${randomId}`;

        const completePersonaStep = (eidvPassed) => {
          const decisionKey = `${stepKey}|${eidvPassed ? "pass" : "fail"}`;
          if (personaAutoAdvanceRef.current === decisionKey) {
            return;
          }
          personaAutoAdvanceRef.current = decisionKey;
          go("next", {
            forceEmptyValues: true,
            skipOfferValidation: true,
            overrideValues: [{ attribute: "eidvPassed", value: eidvPassed }],
          });
        };

        const personaFlowConfig = {
          inquiryId: stepPersonaResponse.id,
          ...(stepPersonaResponse.sessionToken
            ? { sessionToken: stepPersonaResponse.sessionToken }
            : {}),
        };

        Persona.setupEvents(containerId, {
          onComplete: () => completePersonaStep(true),
          onCancel: () => completePersonaStep(false),
          onError: () => completePersonaStep(false),
          ...personaFlowConfig,
        });

        Persona.setupIframe(personaIframeRef.current, containerId, "inline", {
          ...personaFlowConfig,
          frameHeight: "700px",
          fields: {
            nameFirst: stepPersonaResponse.firstName || "",
            nameLast: stepPersonaResponse.lastName || "",
          },
        });
      } catch (e) {
        setError(e.message || "Persona widget initialization failed");
      }
    }

    setupPersonaInline();

    return () => {
      cancelled = true;
    };
  }, [isPersonaStep, step?.journeyStep, externalId, stepPersonaResponse]);

  useEffect(() => {
    if (!isStripeStep) {
      stripeInitRef.current = "";
      stripeAutoAdvanceRef.current = "";
      if (stripeMountRef.current) {
        stripeMountRef.current.innerHTML = "";
      }
      stripeStateRef.current = {
        stripe: null,
        elements: null,
        clientSecret: null,
      };
      return;
    }

    const stepKey = `${step?.journeyStep || ""}|${externalId || ""}`;
    if (!stripeMountRef.current || stripeInitRef.current === stepKey) {
      return;
    }

    let cancelled = false;
    async function initStripeInline() {
      try {
        setError("");
        const StripeCtor = await ensureStripeLibrary();
        if (cancelled || !stripeMountRef.current) {
          return;
        }

        const stripeToken = stepStripePaymentDetails?.stripeToken || "";
        const stripeConfigData = stepStripePaymentDetails?.stripeConfigData || {};
        const clientSecret =
          stepStripePaymentDetails?.paymentIntentResponse?.client_secret ||
          stepStripePaymentDetails?.paymentIntentResponse?.clientSecret ||
          stripeConfigData?.client_secret ||
          stripeConfigData?.clientSecret ||
          null;

        if (!stripeToken) {
          throw new Error("Missing Stripe token.");
        }
        if (!clientSecret) {
          throw new Error("Missing Stripe client secret.");
        }

        const stripe = StripeCtor(stripeToken);
        const elements = stripe.elements({
          clientSecret,
          appearance: {},
        });

        stripeMountRef.current.innerHTML = "";
        const paymentElement = elements.create("payment");
        paymentElement.mount(stripeMountRef.current);

        stripeStateRef.current = {
          stripe,
          elements,
          clientSecret,
        };
        stripeInitRef.current = stepKey;
      } catch (e) {
        const message = e?.message || "Stripe initialization failed.";
        setError(message);
      }
    }

    initStripeInline();
    return () => {
      cancelled = true;
    };
  }, [isStripeStep, step?.journeyStep, externalId, stepStripePaymentDetails]);

  useEffect(() => {
    if (!isSummaryStep || !externalId) {
      setSummarySelectedOffers([]);
      setSummaryLoading(false);
      setSummaryError("");
      return;
    }

    const viewStep = sessionStorage.getItem(OFFER_VIEW_STEP_STORAGE_KEY) || "";
    if (!viewStep) {
      setSummarySelectedOffers([]);
      setSummaryLoading(false);
      setSummaryError("Could not find selected offer details for this summary step.");
      return;
    }

    let cancelled = false;
    async function loadSummarySelectedOffers() {
      try {
        setSummaryLoading(true);
        setSummaryError("");
        const response = await fetch("/api/journey/view-item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            externalId,
            journeyStep: viewStep,
          }),
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(extractApiErrorMessage(payload, "Load summary offer failed"));
        }

        if (cancelled) {
          return;
        }

        setSummarySelectedOffers(extractSummarySelectedOffers(payload));
      } catch (e) {
        if (cancelled) {
          return;
        }
        setSummarySelectedOffers([]);
        setSummaryError(e.message || "Load summary offer failed");
      } finally {
        if (!cancelled) {
          setSummaryLoading(false);
        }
      }
    }

    loadSummarySelectedOffers();
    return () => {
      cancelled = true;
    };
  }, [isSummaryStep, externalId]);

  function isCompletedSigningUrl(url) {
    if (!url) {
      return false;
    }

    const parsedUrl = new URL(url, window.location.origin);
    if (parsedUrl.pathname === ESIGN_CALLBACK_PATH) {
      return true;
    }

    const lowered = url.toLowerCase();
    return (
      lowered.includes("signing_complete") ||
      lowered.includes("signing-complete") ||
      lowered.includes("event=complete") ||
      lowered.includes("status=completed")
    );
  }

  function onEsignIframeLoad() {
    if (!isESignStep || !esignIframeRef.current) {
      return;
    }

    try {
      const href = esignIframeRef.current.contentWindow?.location?.href || "";
      if (!href) {
        return;
      }

      const isSameOrigin = href.startsWith(window.location.origin);
      if (!isSameOrigin || !isCompletedSigningUrl(href)) {
        return;
      }

      const stepKey = `${step?.journeyStep || ""}|${externalId || ""}`;
      if (esignAutoAdvanceRef.current === stepKey) {
        return;
      }
      esignAutoAdvanceRef.current = stepKey;
      go("next", { forceEmptyValues: true, skipOfferValidation: true });
    } catch (_error) {
      // Ignore cross-origin iframe access errors while DocuSign is open.
    }
  }

  async function onStripeSubmit(event) {
    event.preventDefault();
    const stripe = stripeStateRef.current.stripe;
    const elements = stripeStateRef.current.elements;
    const clientSecret = stripeStateRef.current.clientSecret;

    if (!stripe || !elements || !clientSecret) {
      const message = "Stripe is not ready.";
      setError(message);
      return;
    }

    setStripeSubmitting(true);
    setError("");
    try {
      const submitResult = await elements.submit();
      if (submitResult?.error) {
        const message = submitResult.error.message || "Payment validation failed.";
        setError(message);
        return;
      }

      const result = await stripe.confirmPayment({
        elements,
        clientSecret,
        redirect: "if_required",
      });

      if (result?.error) {
        const message = result.error.message || "Payment failed.";
        setError(message);
        return;
      }

      const status = result?.paymentIntent?.status;
      if (status === "succeeded" || status === "processing") {
        const stepKey = `${step?.journeyStep || ""}|${externalId || ""}`;
        if (stripeAutoAdvanceRef.current === stepKey) {
          return;
        }
        stripeAutoAdvanceRef.current = stepKey;
        go("next");
        return;
      }

      const message = "Payment did not complete.";
      setError(message);
    } catch (e) {
      const message = e?.message || "Unexpected payment error.";
      setError(message);
    } finally {
      setStripeSubmitting(false);
    }
  }

  function onSelectOffer(offerId) {
    setSelectedOfferId(offerId);
    sessionStorage.setItem(SELECTED_OFFER_STORAGE_KEY, offerId);
  }

  async function reloadStep(targetExternalId = externalId) {
    const response = await fetch("/api/journey/load-step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ externalId: targetExternalId }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(extractApiErrorMessage(payload, "Load step failed"));
    }

    setStep(payload);
  }

  async function go(
    action,
    options = {
      forceEmptyValues: false,
      skipOfferValidation: false,
      overrideValues: null,
    },
  ) {
    if (actionInFlightRef.current) {
      return;
    }

    try {
      actionInFlightRef.current = true;
      setLoading(true);
      setError("");

      const values = options.forceEmptyValues
        ? []
        : buildValuesFromStep(step, formValues);
      const isOffersSelectionStep = offerCards.length > 0;
      if (
        isOffersSelectionStep &&
        action === "next" &&
        !selectedOfferId &&
        !options.skipOfferValidation
      ) {
        throw new Error("Please select an offer before continuing.");
      }

      if (isOffersSelectionStep && action === "next" && !options.forceEmptyValues) {
        const selectedOffersPayload = buildSelectedOffersPayload(
          stepAvailableOffers,
          selectedOfferId,
        );
        const valuesWithoutSelectedOfferIds = values.filter(
          (item) => item.attribute !== "selectedOfferIds",
        );
        valuesWithoutSelectedOfferIds.push({
          attribute: "selectedOfferIds",
          value: JSON.stringify(selectedOffersPayload),
        });
        values.length = 0;
        values.push(...valuesWithoutSelectedOfferIds);
      }

      if (Array.isArray(options.overrideValues)) {
        values.length = 0;
        values.push(...options.overrideValues);
      }

      const response = await fetch(`/api/journey/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalId, values }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(payload, `${action} failed`));
      }

      const nextExternalId = payload?.externalId || externalId;
      setExternalId(nextExternalId);
      sessionStorage.setItem(EXTERNAL_ID_STORAGE_KEY, nextExternalId);

      if (payload?.step) {
        setStep(payload.step);
      } else {
        await reloadStep(nextExternalId);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      actionInFlightRef.current = false;
      setLoading(false);
    }
  }

  async function restartJourney() {
    if (actionInFlightRef.current) {
      return;
    }

    try {
      actionInFlightRef.current = true;
      await startNewJourney();
    } catch (e) {
      setError(e.message);
    } finally {
      actionInFlightRef.current = false;
      setLoading(false);
    }
  }

  function onFieldChange(field, value) {
    const ui = getFieldUi(field);
    const transformedValue =
      typeof ui.mask === "string" ? applyNamedMask(String(value ?? ""), ui.mask) : value;
    setFormValues((previous) => ({
      ...previous,
      [field.name]: coerceFieldValueForChange(field, transformedValue),
    }));
  }

  if (isEsignCallbackPage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
        <div className="max-w-md w-full rounded-xl border border-green-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">eSign Completed</h1>
          <p className="mt-2 text-sm text-gray-600">
            Returning to the journey flow...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col">
      <header className="w-full bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img
              src="../assets/ESL-logo.png"
              alt="Logo"
              className="h-8 w-auto"
            />
            <span className="text-lg font-semibold text-gray-800">
              External Journey
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-8 flex flex-col">
          <div className="">
            {loading && !step ? (
              <div className="font-medium text-blue-600">
                Loading journey...
              </div>
            ) : (
              step && (
                <div className="">
                  <h1 className="text-2xl font-semibold text-gray-800 text-center mb-6">
                    {stepTitle}
                  </h1>

                  {(step.fields || []).length === 0 &&
                    !isOffersStep &&
                    !isActionStep &&
                    !isESignStep &&
                    !isPersonaStep &&
                    !isSummaryStep &&
                    !isEidvCompletedStep &&
                    !isDocumentsSignedStep && (
                    <p className="font-medium trxt-gray-800 text-center">
                      No fields on this step.
                    </p>
                  )}

                  {(step.fields || []).length === 0 &&
                    !isOffersStep &&
                    !isActionStep &&
                    !isESignStep &&
                    !isPersonaStep &&
                    !isSummaryStep &&
                    !isEidvCompletedStep &&
                    isDocumentsSignedStep && (
                      <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center">
                        <p className="text-sm font-medium text-green-800">
                          Your documents have been signed successfully. A copy has
                          been sent to your email address. You can continue the
                          journey.
                        </p>
                      </div>
                    )}

                  {(step.fields || []).length === 0 &&
                    !isOffersStep &&
                    !isActionStep &&
                    !isESignStep &&
                    !isPersonaStep &&
                    !isSummaryStep &&
                    isEidvCompletedStep && (
                      <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center">
                        <p className="text-sm font-medium text-green-800">
                          Your identity verification was completed successfully.
                          You can continue the journey.
                        </p>
                      </div>
                    )}

                  {isActionStep && (
                    <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-center">
                      <p className="text-sm font-medium text-blue-700">
                        Processing step, please wait...
                      </p>
                    </div>
                  )}

                  {isESignStep && (
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <p className="text-sm text-gray-600 mb-3">
                        Review and complete the eSign flow below.
                      </p>
                      <iframe
                        ref={esignIframeRef}
                        title="DocuSign Embedded Signing"
                        src={stepEsignUrl}
                        onLoad={onEsignIframeLoad}
                        className="w-full h-[700px] rounded-lg border border-gray-200"
                      />
                    </div>
                  )}

                  {isPersonaStep && (
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <p className="text-sm text-gray-600 mb-3">
                        Identity verification is in progress. Please complete the
                        Persona flow below.
                      </p>
                      <div className="persona-widget">
                        <iframe
                          ref={personaIframeRef}
                          style={{ width: "100%", height: "700px", borderRadius: "12px" }}
                          id="persona-inline-iframe"
                          title="Persona eIDV"
                        />
                      </div>
                    </div>
                  )}

                  {isSummaryStep && (
                    <div className="rounded-xl border border-gray-200 bg-white p-4">
                      <p className="text-sm text-gray-600 mb-3">
                        Summary of your selected offer and products.
                      </p>
                      {summaryLoading && (
                        <p className="text-sm text-blue-700">Loading selected offer...</p>
                      )}
                      {summaryError && (
                        <p className="text-sm text-red-700">Summary error: {summaryError}</p>
                      )}
                      {!summaryLoading &&
                        !summaryError &&
                        summarySelectedOffers.length === 0 && (
                          <p className="text-sm text-gray-600">
                            No selected offer information found.
                          </p>
                        )}
                      <div className="space-y-4">
                        {summarySelectedOffers.map((offer, index) => (
                          <div
                            key={`${offer.offerId || "offer"}-${index}`}
                            className="rounded-xl border border-gray-200 p-4 bg-gray-50"
                          >
                            <h3 className="text-lg font-semibold text-gray-900">
                              {offer.offerName || "Selected Offer"}
                            </h3>
                            <p className="text-xs text-gray-500 mt-1">
                              Offer ID: {offer.offerId || "N/A"}
                            </p>
                            {Array.isArray(offer.productsCategory) &&
                              offer.productsCategory.length > 0 && (
                                <p className="text-sm text-gray-700 mt-2">
                                  Categories: {offer.productsCategory.join(", ")}
                                </p>
                              )}
                            {Array.isArray(offer.offerProducts) &&
                              offer.offerProducts.length > 0 && (
                                <div className="mt-3">
                                  <p className="text-sm font-medium text-gray-800 mb-1">
                                    Included products
                                  </p>
                                  <ul className="space-y-2">
                                    {offer.offerProducts.map((product, productIndex) => (
                                      <li
                                        key={`${offer.offerId || "offer"}-product-${productIndex}`}
                                        className="text-sm text-gray-700"
                                      >
                                        {product.productName || "Product"}
                                        {product.productCode ? ` (${product.productCode})` : ""}
                                        {product.productCategory
                                          ? ` - ${product.productCategory}`
                                          : ""}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {isOffersStep && (
                    <div className="offers">
                      {offerCards.length === 0 && <p>No available offers.</p>}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                        {offerCards.map((offer) => {
                          const isSelected = selectedOfferId === offer.offerId;
                          return (
                            <div
                              key={`${offer.offerId}-${offer.cardId}`}
                              className={`
                              flex flex-col
                              rounded-2xl border bg-white p-6
                              transition-all duration-300
                              hover:shadow-xl hover:-translate-y-1
                              ${isSelected
                                  ? "border-blue-600 ring-2 ring-blue-100 shadow-lg"
                                  : "border-gray-200"
                                }
                            `}
                            >
                              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                                {offer.cardTitle}
                              </h3>
                              {offer.description && (
                                <p className="text-sm text-gray-600 mb-4">
                                  {offer.description}
                                </p>
                              )}
                              <ul className="mt-5 mb-3 space-y-2 text-sm text-gray-600">
                                {offer.benefits.map((benefit, index) => (
                                  <li
                                    key={`${offer.cardId}-benefit-${index}`}
                                    className="flex items-start gap-2"
                                  >
                                    <span className="text-blue-500 mt-1">
                                      •
                                    </span>
                                    <span>{benefit}</span>
                                  </li>
                                ))}
                              </ul>
                              <div className="mt-auto">
                                <button
                                  type="button"
                                  onClick={() => onSelectOffer(offer.offerId)}
                                  className={`
                                      w-full rounded-xl py-2.5 font-medium transition
                                      ${isSelected
                                      ? "bg-blue-600 text-white hover:bg-blue-700"
                                      : "bg-gray-900 text-white hover:bg-black"
                                    }
                                    `}
                                >
                                  {isSelected ? "Selected" : "Select"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!isOffersStep &&
                    !isActionStep &&
                    !isESignStep &&
                    !isPersonaStep &&
                    !isSummaryStep &&
                    (step.fields || []).map((field) => (
                    <div key={field.name} className="field mb-2">
                      <label
                        htmlFor={field.name}
                        className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1"
                      >
                        <span>{field.displayName || field.name}</span>
                        {normalizeRequiredLevel(field.requiredLevel) === 2 && (
                          <span className="text-xs font-semibold text-red-600">
                            * Required
                          </span>
                        )}
                        {normalizeRequiredLevel(field.requiredLevel) === 1 && (
                          <span className="text-xs font-medium text-amber-600">
                            Recommended
                          </span>
                        )}
                      </label>

                      {(() => {
                        const fieldType = normalizeFieldType(field.type);
                        const fieldUi = getFieldUi(field);
                        const fieldPlaceholder =
                          typeof fieldUi.placeholder === "string"
                            ? fieldUi.placeholder
                            : "";
                        const customInputType =
                          typeof fieldUi.inputType === "string"
                            ? fieldUi.inputType
                            : null;
                        const baseInputClasses =
                          "w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none";

                        if (
                          fieldType === "optionset" &&
                          Array.isArray(field.optionSetValues)
                        ) {
                          return (
                            <div className="relative w-full">
                              <select
                                id={field.name}
                                value={formValues[field.name] ?? ""}
                                onChange={(e) => onFieldChange(field, e.target.value)}
                                disabled={field.isReadOnly}
                                className={`${baseInputClasses} bg-white`}
                                placeholder={fieldPlaceholder}
                              >
                                <option value="">Select...</option>
                                {field.optionSetValues.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.displayName}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        }

                        if (fieldType === "bool") {
                          return (
                            <label className="inline-flex items-center gap-2 mt-1">
                              <input
                                id={field.name}
                                type="checkbox"
                                checked={Boolean(formValues[field.name])}
                                onChange={(e) => onFieldChange(field, e.target.checked)}
                                disabled={field.isReadOnly}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm text-gray-700">Yes</span>
                            </label>
                          );
                        }

                        if (fieldType === "date" || fieldType === "invariantdate") {
                          return (
                            <input
                              id={field.name}
                              type="date"
                              value={formValues[field.name] ?? ""}
                              onChange={(e) => onFieldChange(field, e.target.value)}
                              disabled={field.isReadOnly}
                              className={baseInputClasses}
                              placeholder={fieldPlaceholder}
                            />
                          );
                        }

                        if (fieldType === "datetime") {
                          return (
                            <input
                              id={field.name}
                              type="datetime-local"
                              value={formValues[field.name] ?? ""}
                              onChange={(e) => onFieldChange(field, e.target.value)}
                              disabled={field.isReadOnly}
                              className={baseInputClasses}
                              placeholder={fieldPlaceholder}
                            />
                          );
                        }

                        if (fieldType === "wholenumber") {
                          return (
                            <input
                              id={field.name}
                              type="number"
                              step="1"
                              inputMode="numeric"
                              value={formValues[field.name] ?? ""}
                              onChange={(e) => onFieldChange(field, e.target.value)}
                              disabled={field.isReadOnly}
                              className={baseInputClasses}
                              placeholder={fieldPlaceholder}
                            />
                          );
                        }

                        if (fieldType === "numeric" || fieldType === "money") {
                          return (
                            <input
                              id={field.name}
                              type="number"
                              step="any"
                              inputMode="decimal"
                              value={formValues[field.name] ?? ""}
                              onChange={(e) => onFieldChange(field, e.target.value)}
                              disabled={field.isReadOnly}
                              className={baseInputClasses}
                              placeholder={fieldPlaceholder}
                            />
                          );
                        }

                        if (
                          fieldType === "textarea" ||
                          fieldType === "rawtext" ||
                          fieldType === "html" ||
                          fieldType === "htmlraw" ||
                          fieldType === "xml" ||
                          fieldType === "json" ||
                          fieldType === "css" ||
                          fieldType === "js"
                        ) {
                          return (
                            <textarea
                              id={field.name}
                              value={formValues[field.name] ?? ""}
                              onChange={(e) => onFieldChange(field, e.target.value)}
                              disabled={field.isReadOnly}
                              rows={4}
                              className={baseInputClasses}
                              placeholder={fieldPlaceholder}
                            />
                          );
                        }

                        if (fieldUi.phoneCountrySelect) {
                          const countries = resolvePhoneCountries(field);
                          const fallbackCode = resolveDefaultCountryCode(field, countries);
                          const selectedCountryCode =
                            phoneCountryByField[field.name] || fallbackCode;
                          const phoneParts = splitPhoneValue(
                            formValues[field.name],
                            countries,
                            selectedCountryCode,
                          );

                          return (
                            <div className="grid grid-cols-[140px_1fr] gap-2">
                              <select
                                id={`${field.name}__country`}
                                value={selectedCountryCode}
                                onChange={(e) => {
                                  const nextCode = e.target.value;
                                  setPhoneCountryByField((previous) => ({
                                    ...previous,
                                    [field.name]: nextCode,
                                  }));
                                  onFieldChange(
                                    field,
                                    buildPhoneValue(nextCode, phoneParts.localNumber),
                                  );
                                }}
                                disabled={field.isReadOnly}
                                className={`${baseInputClasses} bg-white`}
                              >
                                {countries.map((country) => (
                                  <option key={country.code} value={country.code}>
                                    {country.flag ? `${country.flag} ` : ""}
                                    {country.label} ({country.code})
                                  </option>
                                ))}
                              </select>
                              <input
                                id={field.name}
                                type="tel"
                                value={phoneParts.localNumber}
                                onChange={(e) =>
                                  onFieldChange(
                                    field,
                                    buildPhoneValue(selectedCountryCode, e.target.value),
                                  )
                                }
                                disabled={field.isReadOnly}
                                className={baseInputClasses}
                                placeholder={fieldPlaceholder || "555 123 4567"}
                              />
                            </div>
                          );
                        }

                        return (
                          <input
                            id={field.name}
                            type={customInputType || "text"}
                            value={formValues[field.name] ?? ""}
                            onChange={(e) => onFieldChange(field, e.target.value)}
                            disabled={field.isReadOnly}
                            className={baseInputClasses}
                            placeholder={fieldPlaceholder}
                          />
                        );
                      })()}
                    </div>
                  ))}

                  {isStripeStep && (
                    <div className="rounded-xl border border-gray-200 bg-white p-3 mt-4">
                      <p className="text-sm text-gray-600 mb-3">
                        Complete your payment below to continue the journey.
                      </p>
                      <form onSubmit={onStripeSubmit}>
                        <div
                          ref={stripeMountRef}
                          className="w-full min-h-[360px] rounded-lg border border-gray-200 bg-white p-3"
                        />
                        <button
                          type="submit"
                          disabled={stripeSubmitting || loading}
                          className="mt-3 w-full px-4 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition disabled:opacity-60"
                        >
                          {stripeSubmitting ? "Processing..." : "Make Payment"}
                        </button>
                      </form>
                    </div>
                  )}

                  <div className="flex justify-between mt-10">
                    {showPrevious && (
                      <button
                        className="px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 transition"
                        onClick={() => go("previous")}
                        disabled={loading}
                      >
                        Previous
                      </button>
                    )}

                    {showNext && !isActionStep && !isESignStep && (
                      <button
                        className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition"
                        onClick={() => go("next")}
                        disabled={loading}
                      >
                        Next
                      </button>
                    )}

                    <button
                      className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition"
                      onClick={restartJourney}
                      disabled={loading}
                    >
                      Start New Journey
                    </button>
                  </div>
                </div>
              )
            )}

            {error && <p className="error">Error: {error}</p>}
          </div>
        </div>
      </main>

      <footer className="w-full bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
            <div>
              <span className="font-medium text-gray-700">Journey Name:</span>

              <span className="ml-1 font-mono">
                {" "}
                {metadata?.journeyName
                  ? metadata.journeyName
                  : "fTOSOnboardingAndOriginationOnlineJourney_External"}
              </span>
            </div>
            <div>
              <span className="font-medium text-gray-700">
                External Journey ID:
              </span>
              {externalId && (
                <span
                  className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono bg-yellow-100 text-yellow-800"
                  id="journey_id"
                >
                  {externalId}
                </span>
              )}
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-400">Powered by FintechOS</div>
        </div>
      </footer>
    </div>
  );
}

export default App;
