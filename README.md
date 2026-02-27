# ESL Demo Journey App

This repository contains a two-part application used to run and test a FintechOS Digital Journey externally:
- `server` (Node.js + Express): API proxy/orchestration layer
- `client` (React + Vite): dynamic journey UI

## What This App Does

The app executes a Digital Journey step-by-step and renders UI from `load step` responses.
It supports:
- dynamic field rendering by field type
- `next` / `previous` navigation
- custom processor step-actions triggered on load
- external integrations rendered inline (eSign, Persona eIDV, Stripe)
- offer selection and selected-offer summary
- configurable per-step field order/visibility/UI overrides

## Main Runtime Flow

1. Frontend calls `POST /api/journey/init`.
2. Backend calls FintechOS metadata + start + load step.
3. Backend executes `callCustomProcessor` step-actions (if present) in order.
4. Backend returns an enriched step payload to the frontend.
5. Frontend renders the step and posts values to:
- `POST /api/journey/next`
- `POST /api/journey/previous`
6. Backend reloads step and repeats.

Action-type steps (`journeyStepType = action`) are auto-advanced with empty values and shown as processing steps.

## Custom Processor Strategy

For each loaded step, backend inspects `stepActions`.
If there are actions with `type = callCustomProcessor`, backend calls:
- `FINTECHOS_CALL_STEP_ACTION_ENDPOINT/{stepActionId}/{externalId}?culture=...`

The app merges useful `actionResponse` payloads into step data:
- `availableOffers`
- `esignUrl`
- `personaResponse`
- `stripePaymentDetails`

This enables the frontend to switch UI mode based on data returned by the custom processor.

## Step Overrides

Overrides are configured in:
- `server/config/step-overrides.json`

Scope:
- optional filtering by `journeyName`
- matching by exact `journeyStep`
- field-level overrides only

Supported overrides:
- field display order (list order in JSON, or optional `orderIdx` / `orderIndex`)
- `isVisible` (hide/show)
- UI metadata:
  - `placeholder`
  - `inputType` (for example `email`, `tel`)
  - `mask` (currently `ssn`)
  - `phoneCountrySelect`
  - `defaultCountryCode`
  - `phoneCountries`

Fallback behavior:
- step not configured => default load-step behavior
- configured step, missing fields in config => those fields stay visible and are appended after configured fields

Important:
- `requiredLevel` is always taken from load-step response and displayed in UI (`Required` / `Recommended`), not overridden from `step-overrides`.

## Integrations Implemented

### Available Offers from Step-Action
- If `actionResponse.availableOffers` exists, the app renders offer cards instead of generic fields.
- Single selection is allowed.
- On `Next`, selected offer is serialized into `selectedOfferIds` as JSON string (with full offer details needed downstream).

### eSign (DocuSign)
- If `actionResponse.esignUrl` exists, app renders inline iframe.
- Callback route: `/esign/callback`.
- On completion callback, app auto-calls journey `next`.

### Persona eIDV
- If `actionResponse.personaResponse.id` exists, app renders Persona inline iframe.
- On complete => sends `eidvPassed = true`.
- On cancel/error => sends `eidvPassed = false`.

### Stripe
- If `actionResponse.stripePaymentDetails` exists, app initializes Stripe Payment Element inline.
- `fundingAmount` remains visible on page and is still sent on `next`.
- On successful payment confirmation, app auto-calls journey `next`.

## Field UX Enhancements

- Dynamic field types supported: text, bool, date, datetime, whole number, numeric/money, textarea-style types, option sets.
- Required markers based on `requiredLevel`:
  - `2` => Required
  - `1` => Recommended
- SSN mask:
  - UI format: `XXX-XX-XXXX`
  - submitted value: digits only
- Phone with country selector:
  - UI: country + local number
  - submitted value: normalized `+` format without spaces

## API Endpoints (Server)

- `GET /api/health`
- `POST /api/journey/init`
- `POST /api/journey/load-step`
- `POST /api/journey/next`
- `POST /api/journey/previous`
- `POST /api/journey/view-item`
- `POST /api/offers/available`

## Local Setup

Install:
```bash
cd server && npm install
cd ../client && npm install
```

Run backend:
```bash
cd server
npm run dev
```

Run frontend:
```bash
cd client
npm run dev
```

Default URLs:
- backend: `http://localhost:3000`
- frontend: `http://localhost:5173`

## Configuration

Runtime config is read from root `.env`.

Core variables:
- `FINTECHOS_BASE_URL`
- `FINTECHOS_CULTURE`
- `FINTECHOS_START_ENDPOINT`
- `FINTECHOS_LOAD_METADATA_ENDPOINT`
- `FINTECHOS_LOAD_STEP_ENDPOINT`
- `FINTECHOS_NEXT_ENDPOINT`
- `FINTECHOS_PREVIOUS_ENDPOINT`
- `FINTECHOS_CALL_STEP_ACTION_ENDPOINT`
- `FINTECHOS_CALL_VIEW_ITEM`
- auth (`FINTECHOS_USER_NAME`/`FINTECHOS_PASSWORD` or `FINTECHOS_CLIENT_ID`/`FINTECHOS_CLIENT_SECRET`)

## FintechOS Studio Journey Configuration

Journey form:
- `fTOSOnboardingAndOriginationOnlineJourney_External`
- https://esldemo.ondisplayftos.com/studio/#/entity/entityform/edit/9d5b9c2a-36dc-4a06-8a1d-ca0f585df4eb/pageno/5

This section documents practical examples from this journey implementation.  
It is not intended as a strict best-practice guide.

### Example 1: Verify Phone Number

Step:
- `Verify_Phone_Number`
- https://esldemo.ondisplayftos.com/studio/#/entity/entityformsection/edit/8697a2b4-da51-447d-bd98-9666eb3fff7f/pageno/1

Configuration:
- A step action button `Set Products Definition` calls `VEL_SetProductDefinition`.
- Workflow:
  https://esldemo.ondisplayftos.com/studio/#/entity/workflow/edit/407a8438-25de-4add-8a21-7a1ade5f9f6a

Purpose:
- Set the product definitions used later in the journey.

Note:
- In external UI mode, both button-based and action-based implementations can work.
- Current integration consumes step-action responses through `callCustomProcessor`.

### Example 2: Product Selection and Offer Retrieval

Step:
- `Product_Selection`
- https://esldemo.ondisplayftos.com/studio/#/entity/entityformsection/edit/dd612a49-195f-4951-ae48-6d5c2e2cec5f/pageno/0

Configuration:
- A step action button `Get Offers` calls `SE_GetOffersPricing_External`.
- Workflow:
  https://esldemo.ondisplayftos.com/studio/#/entity/workflow/edit/c77847b3-c3c8-445e-b53a-c212531d146c

Details:
- Offer data is fetched based on the product definition set in previous steps.
- The endpoint has a custom JSON output schema.
- Schema validation helps map output to model attributes (for example `AvailableOffers`) and makes payload contracts explicit.
- In external UI, the response is immediately available in `actionResponse.availableOffers` from the step-action call.

Flow-control behavior in this step:
- Rule can skip upsell and navigate directly to Persona.
- Uses boolean attribute `AllProductsSelected`.
- Rule reference:
  https://esldemo.ondisplayftos.com/studio/#/entity/entityFormSectionRule/edit/d242ddc5-a292-4c0f-8930-d60325dd4f9a

How `AllProductsSelected` is set:
- Step action `skipBundle` invokes the form-level action `SkipOfferBundle`.
- Form action location:
  https://esldemo.ondisplayftos.com/studio/#/entity/entityform/edit/9d5b9c2a-36dc-4a06-8a1d-ca0f585df4eb/pageno/9
- Underlying workflow `VEL_SkipOfferBundle_External`:
  https://esldemo.ondisplayftos.com/studio/#/entity/workflow/edit/091e83f1-e30e-4ef5-8d18-f17c563f59c5
- Input contains selected offers (`selectedOffers`).
- External UI sends selected offer data before triggering next step, then step-complete actions update `AllProductsSelected` prior to flow-control evaluation.
- `AllProductsSelected` is not the most intuitive attribute name in this external app, because UI selection is single-offer only.
- For demonstration purposes, workflow logic in `VEL_SkipOfferBundle_External` sets routing so that users are sent to the upsell offers step when the selected offer is `Free Checking Offer` or `Premier Checking Offer`.

### Example 3: Persona eIDV

Step:
- `Persona_eIDV`
- https://esldemo.ondisplayftos.com/studio/#/entity/entityformsection/edit/c7931e92-9eae-40ca-be48-244c70e09359/pageno/1

Configuration:
- Step action calls `Persona_DC_Integration_External`.
- Workflow:
  https://esldemo.ondisplayftos.com/studio/#/entity/workflow/edit/f2eeaa6e-075e-4160-ac72-d18e6a1a4a28

Details:
- Integration is done through Data Core.
- Action returns data required for inline Persona rendering.
- At completion/cancel/error, external UI updates `eidvPassed` and continues flow.

### Runtime Step Execution Order

Form-driven flow execution sequence:
1. On Step Enter actions run.
2. External UI sends `next` with user-provided values.
3. On Step Complete actions run (if next succeeds).
4. Flow Control rules are evaluated.

### UI Notes for This Duplicated Journey

- Some native form UI artifacts still exist in Studio (headings, local buttons) because the journey was duplicated for fast iteration.
- External UI does not render native section content directly.
- Navigation visibility is driven by step General tab settings:
  - `Show Next button`
  - `Show Previous button`

Feel free to explore the remaining steps, actions, and workflow rules.  
The examples above cover the main integration patterns used in this implementation, but there may be additional valid configuration variants that I may have missed explaining above.
