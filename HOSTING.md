# Putting MILCO FIS online (free)

The app and the API run together as **one Render web service**; the database is a free **Neon** PostgreSQL
(Render's own free database is deleted after 30 days, Neon's is not). You need: a GitHub account, a Neon account
and a Render account. No credit card.

## 1. Put the code on GitHub
1. Sign in at github.com → **+** (top right) → **New repository** → name `milco-fis`, choose **Private** → **Create repository**.
2. On the new page click **uploading an existing file**.
3. Open your `milco-fis` folder, select **everything inside it except** `node_modules`, `dist` and `.env`
   (`.env` may contain your PC's database password), and drag it into the browser window.
4. Click **Commit changes**. Check that `package.json` and `render.yaml` are at the top level of the repository.

## 2. Create the database on Neon
1. Sign up at neon.tech → **Create project**: name `milco`, Postgres version 16 or 17, region **AWS Europe Central (Frankfurt)**.
2. On the project dashboard click **Connect**, and copy the connection string. It looks like:
   `postgresql://neondb_owner:xxxx@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
   Keep it secret: it is the database password.

## 3. Create the app on Render
1. Sign up at render.com with your GitHub account.
2. **New** → **Blueprint** → choose the `milco-fis` repository → Render reads `render.yaml`.
3. When it asks for **DATABASE_URL**, paste the Neon connection string → **Apply**.
4. Wait for the build (about 3–5 minutes). The first start fills the database (about 1 minute).
   In **Logs** you should see `Connected to PostgreSQL database "neondb"`.
5. Open the address at the top of the page, e.g. `https://milco-fis.onrender.com`, and sign in.

## Things to know
- **First visit after a quiet spell is slow.** A free Render service sleeps after 15 minutes without visitors and takes
  about 30–60 seconds to wake up. Open the link a minute before you present.
- **Your data stays** in Neon when the app sleeps, restarts or is redeployed.
- **Anyone with the link can open the sign-in page.** Before sharing it widely: sign in as each user and change the
  password (Password button), then in Render → **Environment** set `SHOW_DEMO_ACCOUNTS` to `false`.
- **Updating the app:** upload the changed files to GitHub again; Render redeploys automatically.
- **Start the data again:** sign in as `manager` → **Limits & reset** → Reset all business data.
- **Other hosts** work the same way: set `DATABASE_URL`, build with `npm install --include=dev && npm run build`,
  start with `node server/index.js`, and set `TZ=Africa/Maseru`.
