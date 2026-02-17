# ESL Demo Simplified

Aplicatie simpla in 2 parti:
- `server` = Node + Express care consuma API-urile FintechOS
- `client` = React care afiseaza dinamic pasii din journey

## 1) Instalare

Din root-ul proiectului ruleaza:

```bash
cd server
npm install

cd ../client
npm install
```

## 2) Pornire backend (cu nodemon)

```bash
cd server
npm run dev
```

Serverul ruleaza pe `http://localhost:3000`.

## 3) Pornire frontend React

In alt terminal:

```bash
cd client
npm run dev
```

Frontend-ul ruleaza pe `http://localhost:5173`.

## Ce face fluxul

1. La deschiderea paginii: `Start Journey` + `Load Step` (prin endpoint-ul `init` din backend).
2. UI-ul afiseaza campurile din `Load Step`.
3. Butoanele `Next/Previous` apar in functie de `properties.nextButton.show` si `properties.previousButton.show`.
4. La click `Next/Previous`, frontend-ul trimite valorile completate in body:
   - `values: [{ attribute, value }]`
5. Dupa fiecare `Next/Previous`, frontend-ul apeleaza din nou `Load Step` si redeseneaza pagina.

## Endpoint-uri backend

- `POST /api/journey/init`
- `POST /api/journey/load-step`
- `POST /api/journey/next`
- `POST /api/journey/previous`

Configurarea se citeste din `.env` din root.
