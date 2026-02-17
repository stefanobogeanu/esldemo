import { useEffect, useMemo, useRef, useState } from 'react';

const EXTERNAL_ID_STORAGE_KEY = 'journeyExternalId';
const SELECTED_OFFER_STORAGE_KEY = 'selectedOfferId';

function buildValuesFromStep(step, formValues) {
  const fields = step?.fields || [];
  return fields.map((field) => ({
    attribute: field.name,
    value: formValues[field.name] ?? '',
  }));
}

function App() {
  const [externalId, setExternalId] = useState('');
  const [metadata, setMetadata] = useState(null);
  const [step, setStep] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersError, setOffersError] = useState('');
  const [offerCards, setOfferCards] = useState([]);
  const [selectedOfferId, setSelectedOfferId] = useState(
    () => sessionStorage.getItem(SELECTED_OFFER_STORAGE_KEY) || ''
  );
  const actionInFlightRef = useRef(false);
  const initializedRef = useRef(false);
  const isLastStep = Boolean(step?.isLastStep);

  async function startNewJourney() {
    setLoading(true);
    setError('');
    setOffersError('');
    setOfferCards([]);
    setSelectedOfferId('');
    setFormValues({});

    sessionStorage.removeItem(EXTERNAL_ID_STORAGE_KEY);
    sessionStorage.removeItem(SELECTED_OFFER_STORAGE_KEY);

    const response = await fetch('/api/journey/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.details || payload?.message || 'Restart journey failed');
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
        setError('');

        const storedExternalId = sessionStorage.getItem(EXTERNAL_ID_STORAGE_KEY);
        if (storedExternalId) {
          const loadResponse = await fetch('/api/journey/load-step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
          next[field.name] = field.value ?? '';
        }
      }
      return next;
    });
  }, [step]);

  const showNext = Boolean(step?.properties?.nextButton?.show);
  const showPrevious = Boolean(step?.properties?.previousButton?.show);

  const stepTitle = useMemo(() => {
    if (!step?.journeyStep) return 'Step';
    return step.journeyStep.split('-')[0];
  }, [step]);
  const isOffersStep = stepTitle.toLowerCase() === 'offers';

  useEffect(() => {
    async function loadOffers() {
      try {
        setOffersLoading(true);
        setOffersError('');
        setOfferCards([]);

        const response = await fetch('/api/offers/available', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.details || payload?.message || 'Load offers failed');
        }

        const offers = Array.isArray(payload.offers) ? payload.offers : [];
        const cards = [];
        for (const offer of offers) {
          const detailCards = Array.isArray(offer.cards) ? offer.cards : [];
          for (const card of detailCards) {
            cards.push({
              offerId: offer.offerId,
              offerCode: offer.offerCode || '',
              cardId: card.cardId,
              cardTitle: card.cardTitle || offer.offerName || 'Offer',
              description: card.description || '',
              benefits: Array.isArray(card.benefits) ? card.benefits : [],
            });
          }
        }

        setOfferCards(cards);

        const storedSelectedOfferId = sessionStorage.getItem(SELECTED_OFFER_STORAGE_KEY) || '';
        const hasStoredOffer = cards.some((card) => card.offerId === storedSelectedOfferId);
        if (hasStoredOffer) {
          setSelectedOfferId(storedSelectedOfferId);
        } else {
          setSelectedOfferId('');
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
      setOffersError('');
      setOfferCards([]);
    }
  }, [isOffersStep]);

  function onSelectOffer(offerId) {
    setSelectedOfferId(offerId);
    sessionStorage.setItem(SELECTED_OFFER_STORAGE_KEY, offerId);
  }

  async function reloadStep(targetExternalId = externalId) {
    const response = await fetch('/api/journey/load-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalId: targetExternalId }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.details || payload?.message || 'Load step failed');
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
      setError('');

      const values = buildValuesFromStep(step, formValues);

      const response = await fetch(`/api/journey/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalId, values }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.details || payload?.message || `${action} failed`);
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

  if (loading && !step) {
    return <div className="container">Loading journey...</div>;
  }

  return (
    <div className="container">
      <h1>External Journey Demo</h1>

      {metadata?.journeyName && <p>Journey: {metadata.journeyName}</p>}
      {externalId && <p>ExternalId: {externalId}</p>}

      {step && (
        <div className="card">
          <h2>{stepTitle}</h2>

          {(step.fields || []).length === 0 && <p>No fields on this step.</p>}

          {isOffersStep && (
            <div className="offers">
              {offersLoading && <p>Loading offers...</p>}
              {offersError && <p className="error">Offers error: {offersError}</p>}

              {!offersLoading && !offersError && offerCards.length === 0 && (
                <p>No available offers.</p>
              )}

              <div className="offers-grid">
                {offerCards.map((offer) => {
                  const isSelected = selectedOfferId === offer.offerId;
                  return (
                    <div
                      key={`${offer.offerId}-${offer.cardId}`}
                      className={`offer-card ${isSelected ? 'selected' : ''}`}
                    >
                      <h3>{offer.cardTitle}</h3>
                      {offer.description && <p className="offer-description">{offer.description}</p>}
                      <button
                        type="button"
                        className="select-offer-btn"
                        onClick={() => onSelectOffer(offer.offerId)}
                      >
                        {isSelected ? 'Selected' : 'Select'}
                      </button>
                      <ul>
                        {offer.benefits.map((benefit, index) => (
                          <li key={`${offer.cardId}-benefit-${index}`}>{benefit}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(step.fields || []).map((field) => (
            <div key={field.name} className="field">
              <label htmlFor={field.name}>{field.displayName || field.name}</label>

              {field.type === 'optionset' && Array.isArray(field.optionSetValues) ? (
                <select
                  id={field.name}
                  value={formValues[field.name] ?? ''}
                  onChange={(e) => onFieldChange(field.name, e.target.value)}
                  disabled={field.isReadOnly}
                >
                  <option value="">Select...</option>
                  {field.optionSetValues.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.displayName}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={field.name}
                  type="text"
                  value={formValues[field.name] ?? ''}
                  onChange={(e) => onFieldChange(field.name, e.target.value)}
                  disabled={field.isReadOnly}
                />
              )}
            </div>
          ))}

          <div className="buttons">
            {showPrevious && (
              <button onClick={() => go('previous')} disabled={loading}>
                Previous
              </button>
            )}

            {showNext && (
              <button onClick={() => go('next')} disabled={loading}>
                Next
              </button>
            )}

            {isLastStep && (
              <button onClick={restartJourney} disabled={loading}>
                Start New Journey
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="error">Error: {error}</p>}
    </div>
  );
}

export default App;
