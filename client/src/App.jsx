import { useEffect, useMemo, useRef, useState } from "react";

const EXTERNAL_ID_STORAGE_KEY = "journeyExternalId";
const SELECTED_OFFER_STORAGE_KEY = "selectedOfferId";

function buildValuesFromStep(step, formValues) {
  const fields = step?.fields || [];
  return fields.map((field) => ({
    attribute: field.name,
    value: formValues[field.name] ?? "",
  }));
}

function App() {
  const [externalId, setExternalId] = useState("");
  const [metadata, setMetadata] = useState(null);
  const [step, setStep] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersError, setOffersError] = useState("");
  const [offerCards, setOfferCards] = useState([]);
  const [selectedOfferId, setSelectedOfferId] = useState(
    () => sessionStorage.getItem(SELECTED_OFFER_STORAGE_KEY) || "",
  );
  const actionInFlightRef = useRef(false);
  const initializedRef = useRef(false);
  const isLastStep = Boolean(step?.isLastStep);

  async function startNewJourney() {
    setLoading(true);
    setError("");
    setOffersError("");
    setOfferCards([]);
    setSelectedOfferId("");
    setFormValues({});

    sessionStorage.removeItem(EXTERNAL_ID_STORAGE_KEY);
    sessionStorage.removeItem(SELECTED_OFFER_STORAGE_KEY);

    const response = await fetch("/api/journey/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(
        payload?.details || payload?.message || "Restart journey failed",
      );
    }

    setExternalId(payload.externalId);
    setMetadata(payload.metadata);
    setStep(payload.step);
    sessionStorage.setItem(EXTERNAL_ID_STORAGE_KEY, payload.externalId);
  }

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!step?.fields?.length) {
      return;
    }

    setFormValues((previous) => {
      const next = { ...previous };
      for (const field of step.fields) {
        if (next[field.name] === undefined) {
          next[field.name] = field.value ?? "";
        }
      }
      return next;
    });
  }, [step]);

  const showNext = Boolean(step?.properties?.nextButton?.show);
  const showPrevious = Boolean(step?.properties?.previousButton?.show);

  const stepTitle = useMemo(() => {
    if (!step?.journeyStep) return "Step";
    return step.journeyStep.split("-")[0];
  }, [step]);
  const isOffersStep = stepTitle.toLowerCase() === "offers";

  useEffect(() => {
    async function loadOffers() {
      try {
        setOffersLoading(true);
        setOffersError("");
        setOfferCards([]);

        const response = await fetch("/api/offers/available", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(
            payload?.details || payload?.message || "Load offers failed",
          );
        }

        const offers = Array.isArray(payload.offers) ? payload.offers : [];
        const cards = [];
        for (const offer of offers) {
          const detailCards = Array.isArray(offer.cards) ? offer.cards : [];
          for (const card of detailCards) {
            cards.push({
              offerId: offer.offerId,
              offerCode: offer.offerCode || "",
              cardId: card.cardId,
              cardTitle: card.cardTitle || offer.offerName || "Offer",
              description: card.description || "",
              benefits: Array.isArray(card.benefits) ? card.benefits : [],
            });
          }
        }

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
      } catch (e) {
        setOffersError(e.message);
      } finally {
        setOffersLoading(false);
      }
    }

    if (isOffersStep) {
      loadOffers();
    } else {
      setOffersLoading(false);
      setOffersError("");
      setOfferCards([]);
    }
  }, [isOffersStep]);

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
      throw new Error(
        payload?.details || payload?.message || "Load step failed",
      );
    }

    setStep(payload);
  }

  async function go(action) {
    if (actionInFlightRef.current) {
      return;
    }

    try {
      actionInFlightRef.current = true;
      setLoading(true);
      setError("");

      const values = buildValuesFromStep(step, formValues);

      const response = await fetch(`/api/journey/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalId, values }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload?.details || payload?.message || `${action} failed`,
        );
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

  function onFieldChange(name, value) {
    setFormValues((previous) => ({
      ...previous,
      [name]: value,
    }));
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

                  {(step.fields || []).length === 0 && !isOffersStep && (
                    <p className="font-medium trxt-gray-800 text-center">
                      No fields on this step.
                    </p>
                  )}

                  {isOffersStep && (
                    <div className="offers">
                      {offersLoading && <p>Loading offers...</p>}
                      {offersError && (
                        <p className="error">Offers error: {offersError}</p>
                      )}

                      {!offersLoading &&
                        !offersError &&
                        offerCards.length === 0 && <p>No available offers.</p>}

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
                              ${
                                isSelected
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
                                      ${
                                        isSelected
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

                  {(step.fields || []).map((field) => (
                    <div key={field.name} className="field mb-2">
                      <label
                        htmlFor={field.name}
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        {field.displayName || field.name}
                      </label>

                      {field.type === "optionset" &&
                      Array.isArray(field.optionSetValues) ? (
                        <div class="relative w-full">
                          <select
                            id={field.name}
                            value={formValues[field.name] ?? ""}
                            onChange={(e) =>
                              onFieldChange(field.name, e.target.value)
                            }
                            disabled={field.isReadOnly}
                            class="w-full appearance-none border border-gray-300 rounded-lg
           px-3 pr-10 py-2 bg-white
           focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          >
                            <option value="">Select...</option>
                            {field.optionSetValues.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.displayName}
                              </option>
                            ))}
                            <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">
                              <svg
                                class="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  d="M19 9l-7 7-7-7"
                                />
                              </svg>
                            </div>
                          </select>
                        </div>
                      ) : (
                        <input
                          id={field.name}
                          type="text"
                          value={formValues[field.name] ?? ""}
                          onChange={(e) =>
                            onFieldChange(field.name, e.target.value)
                          }
                          disabled={field.isReadOnly}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                      )}
                    </div>
                  ))}

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

                    {showNext && (
                      <button
                        className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition"
                        onClick={() => go("next")}
                        disabled={loading}
                      >
                        Next
                      </button>
                    )}

                    {isLastStep && (
                      <button
                        className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition"
                        onClick={restartJourney}
                        disabled={loading}
                      >
                        Start New Journey
                      </button>
                    )}
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
                  : "externalJourneyExample"}
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
