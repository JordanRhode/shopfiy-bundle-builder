# Bundle Builder — Shopify App

A custom Shopify app that lets merchants create "build-your-own" bundle products (e.g., a custom box of chocolates). Customers pick a quantity variant, select their flavors, and can only add to cart when the correct count is chosen. The app tracks per-flavor inventory and prevents over-selection.

## Project Structure — 16 source files

### Data Layer
- `prisma/schema.prisma` — `Bundle`, `BundleVariantMap`, `BundleOption` models with inventory tracking and cascade deletes
- `app/models/Bundle.server.ts` — CRUD operations scoped by shop domain
- `app/models/BundleOption.server.ts` — Atomic inventory decrement (`WHERE inventory >= qty` prevents race conditions), validation helpers

### Admin UI (Polaris)
- `app/routes/app._index.tsx` — Bundle list with IndexTable, status badges (active/low stock/out of stock), delete with confirmation modal
- `app/routes/app.bundles.$id.tsx` — Create/edit route with full validation
- `app/components/BundleForm.tsx` — Shopify Resource Picker integration, variant-to-selection-count mapping, `allowMultiples` toggle
- `app/components/OptionCard.tsx` — Flavor cards with name, image URL, inventory, reordering

### Storefront (Theme App Extension)
- `extensions/bundle-builder-block/blocks/bundle-builder.liquid` — App Block with configurable settings (heading, columns, colors)
- `extensions/bundle-builder-block/assets/bundle-builder.js` — Full storefront logic: fetches bundle config, renders option grid, enforces selection count, validates inventory, submits to `/cart/add.js` with line item properties
- `extensions/bundle-builder-block/assets/bundle-builder.css` — Responsive grid with selected/disabled states, inventory badges

### API & Webhooks
- `app/routes/app-proxy.bundle.$productId.tsx` — GET endpoint returning bundle config + current inventory
- `app/routes/app-proxy.validate.tsx` — POST endpoint validating selections before add-to-cart
- `app/routes/webhooks.tsx` — `ORDERS_CREATE` decrements inventory atomically; `APP_UNINSTALLED` cleans up

## Key Features

- **Configurable multiples**: Per-bundle toggle — toggle mode (one of each) or quantity mode (+/- controls)
- **Three-layer inventory safety**: Display → pre-flight validation → atomic decrement on order
- **Line item properties**: `_bundle_id` and `_bundle_selections` (hidden) + `Bundle Selections` (visible on order)

## Tech Stack

- **Language**: TypeScript
- **Framework**: Shopify CLI + Remix (`@shopify/shopify-app-remix`)
- **Database**: Prisma ORM with SQLite (dev) / PostgreSQL (prod)
- **Admin UI**: Shopify Polaris
- **Storefront**: Theme App Extension (App Block) with vanilla JS
- **Storefront API**: App Proxy endpoints
- **Order processing**: Shopify webhooks

## Getting Started

1. Replace `client_id` in `shopify.app.toml` with your Shopify Partners app client ID
2. Create a `.env` file from `.env.example` with your API credentials
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run the Prisma migration:
   ```bash
   npx prisma migrate dev
   ```
5. Start the development server:
   ```bash
   npm run dev
   ```
6. Add the "Bundle Selector" App Block to a product page in your theme editor
