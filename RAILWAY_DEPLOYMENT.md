# Deploying Custom Bundle Builder to Railway

## Prerequisites

- A [Railway](https://railway.app) account
- The [Railway CLI](https://docs.railway.app/develop/cli) installed (`npm install -g @railway/cli`)
- Your Shopify Partner account with this app already created
- Git repository pushed to GitHub (Railway deploys from GitHub or via CLI)

---

## Step 1: Switch Prisma from SQLite to PostgreSQL

Railway provides managed PostgreSQL. The app currently uses SQLite (`file:dev.db`), which won't persist on Railway's ephemeral filesystem.

### Update `prisma/schema.prisma`

Change the datasource block:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### Regenerate migrations

```bash
# Delete existing SQLite migrations
rm -rf prisma/migrations
rm -f prisma/dev.db

# Generate a fresh migration for PostgreSQL
npx prisma migrate dev --name init
```

---

## Step 2: Add a Dockerfile

Create a `Dockerfile` in the project root:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN npx prisma generate
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "docker-start"]
```

> The `docker-start` script already exists in `package.json` and runs `npm run setup && npm run start`, which handles `prisma migrate deploy` before starting the server.

---

## Step 3: Create the Railway Project

### Option A: Via Railway Dashboard

1. Go to [railway.app](https://railway.app) and click **New Project**
2. Select **Deploy from GitHub repo** and connect your repository
3. Railway will auto-detect the Dockerfile

### Option B: Via Railway CLI

```bash
railway login
railway init
railway up
```

---

## Step 4: Add a PostgreSQL Database

1. In your Railway project dashboard, click **+ New** > **Database** > **Add PostgreSQL**
2. Railway will automatically inject the `DATABASE_URL` environment variable into your service if both are in the same project
3. Verify the variable is linked: go to your app service > **Variables** tab and confirm `DATABASE_URL` is present

---

## Step 5: Set Environment Variables

In the Railway dashboard, go to your app service > **Variables** and add:

| Variable | Value |
|---|---|
| `SHOPIFY_API_KEY` | Your app's API key (found in `shopify.app.custom-bundle-builder.toml` or Partner dashboard) |
| `SHOPIFY_API_SECRET` | Your app's API secret (from Shopify Partner dashboard) |
| `SCOPES` | `read_orders,read_products,write_products` |
| `SHOPIFY_APP_URL` | Your Railway public URL (e.g., `https://your-app.up.railway.app`) |
| `PORT` | `3000` |
| `NODE_ENV` | `production` |

> `DATABASE_URL` should already be set automatically from the PostgreSQL service.

---

## Step 6: Generate a Public URL on Railway

1. Go to your app service > **Settings** > **Networking**
2. Click **Generate Domain** to get a public `*.up.railway.app` URL
3. Copy this URL -- you'll need it for the next step

---

## Step 7: Update Shopify App Configuration

### Update the App URL in Shopify Partner Dashboard

1. Go to [partners.shopify.com](https://partners.shopify.com) > **Apps** > **Custom Bundle Builder**
2. Under **App setup**, update:
   - **App URL**: `https://your-app.up.railway.app`
   - **Allowed redirection URL(s)**: `https://your-app.up.railway.app/api/auth/callback`

### Update `shopify.app.custom-bundle-builder.toml`

```toml
application_url = "https://your-app.up.railway.app"

[auth]
redirect_urls = [ "https://your-app.up.railway.app/api/auth/callback" ]

[app_proxy]
url = "https://your-app.up.railway.app/app-proxy"
subpath = "bundle-builder"
prefix = "apps"
```

### Deploy the config update to Shopify

```bash
shopify app deploy
```

---

## Step 8: Deploy and Verify

1. Push your changes to GitHub (Railway auto-deploys on push) or run `railway up`
2. Watch the build logs in the Railway dashboard for errors
3. Once deployed, visit your Railway URL -- it should redirect to Shopify OAuth
4. Install the app on your development store and verify it works

---

## Step 9: Set Up the App Proxy (for storefront block)

The theme extension (`bundle-builder-block`) makes requests to your app via Shopify's app proxy. Ensure the app proxy config in the Partner dashboard matches:

- **Subpath prefix**: `apps`
- **Subpath**: `bundle-builder`
- **Proxy URL**: `https://your-app.up.railway.app/app-proxy`

After running `shopify app deploy`, this should be configured automatically from the TOML file.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Build fails on Prisma | Ensure `prisma generate` runs before `npm run build` in the Dockerfile |
| Database connection refused | Check that the PostgreSQL service is in the same Railway project and `DATABASE_URL` is linked |
| OAuth redirect errors | Ensure your Railway URL matches exactly in both the Partner dashboard and TOML config (no trailing slash) |
| App proxy returns 404 | Verify the proxy URL points to your Railway domain and the `/app-proxy` route is accessible |
| `remix-serve` crashes | Make sure `NODE_ENV=production` and `PORT=3000` are set in Railway variables |
