# MILCO Financial Information System (v5)

Made-in-Lesotho Retail Cooperative (MILCO): a full-stack system for the Limkokwing FIS group project.
**React** frontend, **Node.js** API, **PostgreSQL** database (managed in pgAdmin 4).

## What is new in v5

- **MILCO look.** Lesotho-flag colours (blue, white, green) and a MILCO emblem (a mokorotlo). Each department has its own header colour. To use MILCO's official logo, save it as `public/logo.png`.
- **The four MILCO departments with separation of duties.** Every permission is checked by the server, not only hidden in the browser.
- **Approvals inbox.** Large expenses, every payment voucher, manual journals, refunds, stock write-offs, payroll and the budget wait for a second person. Approving posts the transaction to the ledger. Nobody can approve their own request.
- **Real mobile money.** Customers pay to MILCO's **M-Pesa 5884 7088** or **EcoCash 6217 8072**. The till shows the number and amount. The cashier types the transaction ID from the confirmation SMS, and each ID can be used only once. Finance then ticks every ID against the M-Pesa / EcoCash statement. There is optional Vodacom M-Pesa API "push" (see below).
- **Two reporting layers from one database.**
  - Finance sees detailed statements, the trial balance, the general ledger, a cash flow statement, debtors, reconciliation, and ratios with formulas and the input figures.
  - Management sees plain-language ratios with the question each one answers, alerts, revenue vs expenses, the profit trend, sales by store, budget vs actual, an expense drill-down and simplified statements. Nothing is labelled good or bad by a fixed rule: figures are compared with last month, the budget and the targets.
- **HR and payroll.** Staff records, leave, attendance and monthly payroll. **HR prepares → the General Manager approves → Finance pays.**
- **Real price list.** The Finance Manager can import MILCO's shelf prices from a CSV file (Excel → Save as CSV).

## Departments, users and permissions

Demo password for every account: **`milco2026`**

| Department | Username | Role | Can | Cannot |
| --- | --- | --- | --- | --- |
| Management & Administration | `manager` | General Manager | See everything. Approve large expenses, payments, journals, refunds, payroll and the budget. Set targets and approval limits. Manage users. | Approve own requests, record sales, change salaries |
| | `board` | Board Member | Read every report | Change anything |
| Finance & Accounting | `finance` | Finance Manager | Statements, payment vouchers, approve the Accountant's vouchers and journals, approve stock write-offs, void sales, set prices, verify M-Pesa/EcoCash, reconcile, budget, pay payroll, close periods | Approve own payments (they go to the GM), edit staff records |
| | `accountant` | Accountant | Record expenses and receipts, raise payment vouchers and journals (sent for approval), verify mobile money, reconcile, prepare the budget, pay approved payroll | Approve anything, close periods, change prices |
| Retail & Store Operations | `store` | Store Manager (Sefika Store) | Till, receive stock, request stock, report damaged stock, refunds up to the limit, approve cashier refunds, store dashboard | See payroll, change prices or costs, pay suppliers, write off stock without Finance, delete sales |
| | `cashier` | Cashier (Sefika Store) | Till (cash, M-Pesa, EcoCash, card), own sales, request refunds | Approve own refunds, see costs or company figures |
| | `online`, `wholesale` | Store Managers | As the Store Manager, for the Online Shop and Wholesale (including credit customers) | |
| Human Resources | `hr` | HR Officer | Employees, leave, attendance, prepare and submit payroll | Record sales, post financial transactions, pay payroll |

The General Manager can change the approval limits in **Limits & reset**. The defaults are:

| Request | Default limit | Approved by |
| --- | --- | --- |
| Expense | up to M5,000 posts directly | General Manager above the limit |
| Payment voucher | always needs approval | Finance Manager up to M10,000 (General Manager above that, or when the Finance Manager raised it) |
| Refund | up to M500 | Store Manager (cashier refunds); General Manager above the limit |
| Journal | up to M10,000 | Finance Manager approves the Accountant's journals; General Manager above the limit |
| Stock write-off | any amount | Finance Manager |

## Mobile money: how payments work

1. The cashier adds the items and chooses **M-Pesa** or **EcoCash**. The till shows: *send M365.00 to 5884 7088 (MILCO)*.
2. The customer sends the money from their own phone and gets a confirmation SMS. The money goes straight into MILCO's M-Pesa or EcoCash account.
3. The cashier types the **transaction ID** from the SMS and completes the sale. The receipt shows the ID. The system refuses an ID that was already used.
4. In **M-Pesa & bank**, the Accountant or Finance Manager opens the statement for each number and marks every ID as **On statement** or **Not found**. Unchecked payments older than 3 days show as an alert to management.

The numbers are set in `.env` (`MPESA_MERCHANT_NUMBER`, `ECOCASH_MERCHANT_NUMBER`).

**Optional automatic M-Pesa (push to the customer's phone).** Vodacom Lesotho offers an M-Pesa Open API for businesses. With it, the till sends a payment request, the customer enters their PIN, and the transaction ID comes back automatically. To use it:

1. Register MILCO as a business with Vodacom M-Pesa and on the M-Pesa developer portal.
2. Put the API key, public key and service provider code in `.env`.
3. Set `MPESA_API_ENABLED=true` (start with `MPESA_API_ENV=sandbox`).

This part follows Vodacom's published API but could not be tested without MILCO's own credentials. EcoCash has no public API, so EcoCash always uses the transaction-ID method.

## Putting it online

See **HOSTING.md**: free hosting on Render (app) + Neon (database), step by step.

## Setup

### 1. Install

- **Node.js 18 or newer** (nodejs.org, LTS)
- **PostgreSQL 13 or newer** with **pgAdmin 4**. Remember the password of the `postgres` user.

### 2. Add your password to `.env`

Open `.env` in Notepad and put your PostgreSQL password after `DB_PASSWORD=`.

### 3. Upgrading from v4? Rebuild the database once

v5 has new tables: departments, approvals, payroll and payments. In the project folder run:

```
npm install
npm run db:reset
```

This deletes the old `milco_fis` database. The next `npm start` creates it again with the v5 starting data. If you skip this step, the server stops with a message telling you to do it.

### 4. Run

```
npm install
npm start
```

Open **http://localhost:4000** when the window shows `Connected to PostgreSQL`. Keep the window open, and press **Ctrl + C** to stop.
PowerShell users: use `npm.cmd install` and `npm.cmd start` if you see "running scripts is disabled".
Make sure you run the **newest extracted folder** (v5), not an older copy.

### Creating the database by hand in pgAdmin 4 (optional)

The server creates and fills the database by itself. To do it yourself instead:

1. Right-click **Databases → Create → Database…** and name it `milco_fis`.
2. Open **Tools → Query Tool** on `milco_fis`.
3. Run `database/schema.sql` (33 tables and a view).
4. Run `database/seed.sql`.

## Using MILCO's real data

- **Logo:** save it as `public/logo.png`, then run `npm start` again.
- **Products and prices:** sign in as `finance`, open **Prices & stock**, then go to **Import the real price list (CSV)**. The columns are `code,name,store,producer,stock_type,price,cost,reorder`, where `stock_type` is `consignment` (a member producer's goods) or `bought` (MILCO's own stock). Existing codes are updated and new ones are added.
- **Start clean:** set `SAMPLE_TRANSACTIONS=false` in `.env`, then run `npm run db:reset` and `npm start`. FY2026 then starts from the FY2025 closing balances with no sample trading. The General Manager can also reset the data from **Limits & reset**.
- **Staff:** HR edits the employees and salaries in **Staff & payroll**.

The sample trading, products and producers are **illustrative**. MILCO's real figures and prices are not published, so load your own as shown above.

## A 5-minute demonstration for the lecturer

1. Sign in as `cashier`. Sell a scarf by **M-Pesa**: send the amount from a real phone to 5884 7088, type the transaction ID from the SMS, then print the receipt. Try the same ID again and it is refused.
2. In **My sales & refunds**, request a refund. Then sign in as `store` and approve it in **Approvals**.
3. Sign in as `accountant`.
   - Raise a payment voucher to producers. It goes to the Finance Manager.
   - In **M-Pesa & bank**, mark the M-Pesa payment **On statement**.
4. Sign in as `finance` and approve the voucher. Check that the trial balance in **Ledger & TB** still balances.
5. Sign in as `hr` and prepare and submit the November payroll. Then sign in as `manager`:
   - Approve the payroll.
   - Look at the **Overview**: alerts, charts and the plain-language ratios.
6. Sign in as `finance` and pay the payroll in **Payroll**. Then show the **Audit trail**: every step and who did it.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Builds the app and starts the server at http://localhost:4000 |
| `npm run dev` | Development mode with live reload (http://localhost:5173) |
| `npm test` | Checks that the books balance, the ratios are right, every transaction type balances, and nobody can approve their own request |
| `npm run db:reset` | Deletes the `milco_fis` database; the next `npm start` recreates it |
| `npm run db:seed-sql` | Regenerates `database/seed.sql` |

## Useful queries (pgAdmin Query Tool on milco_fis)

```sql
-- Trial balance: debits must equal credits
SELECT SUM(total_debit) AS debits, SUM(total_credit) AS credits FROM v_trial_balance;

-- Mobile money received per number, checked and not yet checked
SELECT provider, merchant_number, verified, COUNT(*), SUM(amount) FROM payments WHERE status = 'received' GROUP BY 1, 2, 3;

-- Requests waiting for approval
SELECT id, kind, amount, summary, approver_role FROM approvals WHERE status = 'pending';

-- Who did what
SELECT logged_at, username, user_role, action FROM audit_log ORDER BY id DESC LIMIT 50;
```

For the ERD: right-click **milco_fis → ERD For Database**.

## Database tables

| Area | Tables |
| --- | --- |
| Organisation and security | `org_units` (4 departments), `departments` (3 stores), `users`, `sessions`, `audit_log`, `settings` |
| Accounting | `fiscal_years`, `accounts`, `annual_balances`, `dept_annual`, `shared_opex_annual`, `ratio_targets`, `dept_targets`, `journal_entries`, `journal_lines`, `v_trial_balance` |
| Retail and stores | `products`, `sales`, `sale_items`, `payments` (M-Pesa/EcoCash IDs), `sale_returns`, `stock_receipts`, `stock_requests`, `stock_adjustments` |
| Finance | `expenses`, `money_movements` (receipts and payment vouchers), `approvals`, `budgets`, `bank_reconciliations` |
| HR | `employees`, `leave_requests`, `attendance`, `payroll_runs`, `payroll_lines` |

## Project structure

```
database/      create_database.sql, schema.sql, seed.sql
public/        favicon.svg; put logo.png here
server/        index.js (start-up), routes/ (core, sales, stock, finance, hr), auth.js (roles and permissions),
               approvals.js (who approves what), posting.js (posting rules and period lock), ledger.js (double entry),
               reports.js and analytics.js (statements, cash flow, budget vs actual, alerts), mpesa.js (Vodacom API),
               seed.js and simulate.js (starting data), db.js, config.js
src/           React app: App.jsx (navigation by role), components/ (Executive, FinanceWork, POS, StoreOps, HR,
               Approvals, Ratios, BalanceSheet, Ledger, ...), lib/finance.js (ratios and both reporting layers)
tests/         npm test
```
