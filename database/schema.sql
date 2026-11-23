-- =====================================================================
-- MILCO Financial Information System v5: PostgreSQL schema
-- Made-in-Lesotho Retail Cooperative (MILCO)
-- PostgreSQL 13 or newer. In pgAdmin 4: select the milco_fis database,
-- open Tools > Query Tool, open this file and press Execute (F5).
-- Safe to run more than once (CREATE ... IF NOT EXISTS).
-- =====================================================================

-- ---------- Organisation ----------
CREATE TABLE IF NOT EXISTS org_units (            -- the four departments of MILCO
  id        VARCHAR(20)   PRIMARY KEY,
  name      VARCHAR(80)   NOT NULL,
  purpose   VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS departments (          -- the stores / sales channels run by Retail and Store Operations
  id           VARCHAR(32)  PRIMARY KEY,
  name         VARCHAR(80)  NOT NULL,
  head_title   VARCHAR(80)  NOT NULL,
  color        VARCHAR(16)  NOT NULL,
  staff        INTEGER      NOT NULL DEFAULT 0,
  description  TEXT,
  sort_order   INTEGER      NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  setting_key    VARCHAR(40)  PRIMARY KEY,
  setting_value  TEXT         NOT NULL
);

-- ---------- Security ----------
CREATE TABLE IF NOT EXISTS users (
  id                    SERIAL       PRIMARY KEY,
  username              VARCHAR(32)  NOT NULL UNIQUE,
  full_name             VARCHAR(80)  NOT NULL,
  user_role             VARCHAR(20)  NOT NULL CHECK (user_role IN ('general_manager', 'board_member', 'finance_manager', 'accountant', 'store_manager', 'cashier', 'hr_officer')),
  org_unit              VARCHAR(20)  NOT NULL REFERENCES org_units(id),
  department_id         VARCHAR(32)  REFERENCES departments(id),
  password_hash         CHAR(128)    NOT NULL,
  password_salt         CHAR(32)     NOT NULL,
  is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
  must_change_password  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (user_role NOT IN ('store_manager', 'cashier') OR department_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sessions (
  token       CHAR(64)  PRIMARY KEY,
  user_id     INTEGER   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  BIGINT    NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id             SERIAL        PRIMARY KEY,
  logged_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  user_id        INTEGER,
  username       VARCHAR(32),
  user_role      VARCHAR(40),
  department_id  VARCHAR(32),
  action         VARCHAR(500)  NOT NULL
);

-- ---------- Accounting structure ----------
CREATE TABLE IF NOT EXISTS fiscal_years (
  code        VARCHAR(8)   PRIMARY KEY,
  label       VARCHAR(20)  NOT NULL,
  start_date  DATE         NOT NULL,
  end_date    DATE         NOT NULL,
  is_closed   BOOLEAN      NOT NULL DEFAULT FALSE,
  CHECK (end_date > start_date)
);

CREATE TABLE IF NOT EXISTS accounts (
  code        VARCHAR(32)   PRIMARY KEY,
  name        VARCHAR(120)  NOT NULL,
  kind        VARCHAR(12)   NOT NULL CHECK (kind IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  section     VARCHAR(8)    NOT NULL CHECK (section IN ('nca', 'ca', 'equity', 'ncl', 'cl', 'income')),
  ratio_tag   VARCHAR(32),
  sort_order  INTEGER       NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS annual_balances (      -- audited totals of closed years
  fin_year      VARCHAR(8)     NOT NULL REFERENCES fiscal_years(code),
  account_code  VARCHAR(32)    NOT NULL REFERENCES accounts(code),
  amount        NUMERIC(14,2)  NOT NULL,
  PRIMARY KEY (fin_year, account_code)
);

CREATE TABLE IF NOT EXISTS dept_annual (
  fin_year       VARCHAR(8)     NOT NULL REFERENCES fiscal_years(code),
  department_id  VARCHAR(32)    NOT NULL REFERENCES departments(id),
  revenue        NUMERIC(14,2)  NOT NULL DEFAULT 0,
  cost_of_sales  NUMERIC(14,2)  NOT NULL DEFAULT 0,
  direct_opex    NUMERIC(14,2)  NOT NULL DEFAULT 0,
  inventory      NUMERIC(14,2)  NOT NULL DEFAULT 0,
  receivables    NUMERIC(14,2)  NOT NULL DEFAULT 0,
  PRIMARY KEY (fin_year, department_id)
);

CREATE TABLE IF NOT EXISTS shared_opex_annual (
  fin_year  VARCHAR(8)     PRIMARY KEY REFERENCES fiscal_years(code),
  amount    NUMERIC(14,2)  NOT NULL
);

CREATE TABLE IF NOT EXISTS ratio_targets ( ratio_id VARCHAR(32) PRIMARY KEY, target_value NUMERIC(12,4) );
CREATE TABLE IF NOT EXISTS dept_targets ( target_id VARCHAR(32) PRIMARY KEY, target_value NUMERIC(12,4) );

-- ---------- General ledger (double entry) ----------
CREATE TABLE IF NOT EXISTS journal_entries (
  id           SERIAL        PRIMARY KEY,
  entry_date   DATE          NOT NULL,
  reference    VARCHAR(40),
  description  VARCHAR(255)  NOT NULL,
  source       VARCHAR(16)   NOT NULL CHECK (source IN ('sale', 'void', 'refund', 'expense', 'stock', 'adjustment', 'money', 'payroll', 'journal')),
  created_by   INTEGER       REFERENCES users(id),
  approved_by  INTEGER       REFERENCES users(id),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_entries_date ON journal_entries (entry_date);

CREATE TABLE IF NOT EXISTS journal_lines (
  id             SERIAL         PRIMARY KEY,
  entry_id       INTEGER        NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_code   VARCHAR(32)    NOT NULL REFERENCES accounts(code),
  department_id  VARCHAR(32)    REFERENCES departments(id),
  category       VARCHAR(40),   -- expense category, used for budget vs actual
  debit          NUMERIC(14,2)  NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit         NUMERIC(14,2)  NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo           VARCHAR(255),
  CHECK (debit = 0 OR credit = 0)
);
CREATE INDEX IF NOT EXISTS ix_lines_entry ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS ix_lines_account ON journal_lines (account_code);

-- ---------- Products, sales and payments (Retail and Store Operations) ----------
CREATE TABLE IF NOT EXISTS products (
  id             SERIAL         PRIMARY KEY,
  code           VARCHAR(20)    NOT NULL UNIQUE,
  name           VARCHAR(120)   NOT NULL,
  department_id  VARCHAR(32)    NOT NULL REFERENCES departments(id),
  producer_name  VARCHAR(120)   NOT NULL,
  stock_type     VARCHAR(12)    NOT NULL CHECK (stock_type IN ('consignment', 'bought')),
  unit_price     NUMERIC(12,2)  NOT NULL CHECK (unit_price >= 0),
  unit_cost      NUMERIC(12,2)  NOT NULL CHECK (unit_cost >= 0),
  stock_qty      INTEGER        NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reorder_level  INTEGER        NOT NULL DEFAULT 0,
  is_active      BOOLEAN        NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sales (
  id                SERIAL         PRIMARY KEY,
  sale_date         DATE           NOT NULL,
  department_id     VARCHAR(32)    NOT NULL REFERENCES departments(id),
  payment_method    VARCHAR(12)    NOT NULL CHECK (payment_method IN ('Cash', 'Card', 'M-Pesa', 'EcoCash', 'Credit')),
  customer_name     VARCHAR(80),
  total_gross       NUMERIC(14,2)  NOT NULL,
  vat_amount        NUMERIC(14,2)  NOT NULL DEFAULT 0,
  total_net         NUMERIC(14,2)  NOT NULL,
  cost_total        NUMERIC(14,2)  NOT NULL,
  refunded_total    NUMERIC(14,2)  NOT NULL DEFAULT 0,
  status            VARCHAR(8)     NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'void')),
  journal_entry_id  INTEGER        REFERENCES journal_entries(id),
  void_entry_id     INTEGER        REFERENCES journal_entries(id),
  void_reason       VARCHAR(200),
  created_by        INTEGER        REFERENCES users(id),
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CHECK (payment_method <> 'Credit' OR customer_name IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_sales_date ON sales (sale_date);
CREATE INDEX IF NOT EXISTS ix_sales_department ON sales (department_id);

CREATE TABLE IF NOT EXISTS sale_items (
  id            SERIAL         PRIMARY KEY,
  sale_id       INTEGER        NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id    INTEGER        NOT NULL REFERENCES products(id),
  product_name  VARCHAR(120)   NOT NULL,
  quantity      INTEGER        NOT NULL CHECK (quantity > 0),
  returned_qty  INTEGER        NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  unit_price    NUMERIC(12,2)  NOT NULL,
  line_total    NUMERIC(14,2)  NOT NULL,
  unit_cost     NUMERIC(12,2)  NOT NULL,
  cost_total    NUMERIC(14,2)  NOT NULL,
  stock_type    VARCHAR(12)    NOT NULL,
  CHECK (returned_qty <= quantity)
);
CREATE INDEX IF NOT EXISTS ix_items_sale ON sale_items (sale_id);

-- Mobile-money payments (M-Pesa, EcoCash) with the transaction reference from the provider.
CREATE TABLE IF NOT EXISTS payments (
  id                 SERIAL         PRIMARY KEY,
  sale_id            INTEGER        REFERENCES sales(id),
  provider           VARCHAR(10)    NOT NULL CHECK (provider IN ('M-Pesa', 'EcoCash', 'Card')),
  merchant_number    VARCHAR(20)    NOT NULL,
  customer_phone     VARCHAR(20),
  reference          VARCHAR(40)    NOT NULL,
  amount             NUMERIC(14,2)  NOT NULL CHECK (amount > 0),
  channel            VARCHAR(10)    NOT NULL DEFAULT 'manual' CHECK (channel IN ('manual', 'api')),
  conversation_id    VARCHAR(80),
  status             VARCHAR(10)    NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'failed', 'refunded')),
  verified           BOOLEAN        NOT NULL DEFAULT FALSE,
  verified_by        INTEGER        REFERENCES users(id),
  verified_at        TIMESTAMPTZ,
  created_by         INTEGER        REFERENCES users(id),
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT now(),
  UNIQUE (provider, reference)
);

CREATE TABLE IF NOT EXISTS sale_returns (
  id                SERIAL         PRIMARY KEY,
  sale_id           INTEGER        NOT NULL REFERENCES sales(id),
  return_date       DATE           NOT NULL,
  amount            NUMERIC(14,2)  NOT NULL,
  restock           BOOLEAN        NOT NULL DEFAULT TRUE,
  reason            VARCHAR(200)   NOT NULL,
  journal_entry_id  INTEGER        REFERENCES journal_entries(id),
  approval_id       INTEGER,
  created_by        INTEGER        REFERENCES users(id),
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_receipts (
  id                SERIAL         PRIMARY KEY,
  receipt_date      DATE           NOT NULL,
  product_id        INTEGER        NOT NULL REFERENCES products(id),
  quantity          INTEGER        NOT NULL CHECK (quantity > 0),
  unit_cost         NUMERIC(12,2)  NOT NULL,
  total_cost        NUMERIC(14,2)  NOT NULL,
  paid_via          VARCHAR(12)    NOT NULL CHECK (paid_via IN ('credit', 'cash', 'bank', 'consignment')),
  journal_entry_id  INTEGER        REFERENCES journal_entries(id),
  created_by        INTEGER        REFERENCES users(id),
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_requests (
  id             SERIAL        PRIMARY KEY,
  product_id     INTEGER       NOT NULL REFERENCES products(id),
  quantity       INTEGER       NOT NULL CHECK (quantity > 0),
  note           VARCHAR(200),
  status         VARCHAR(10)   NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ordered', 'received', 'cancelled')),
  requested_by   INTEGER       REFERENCES users(id),
  handled_by     INTEGER       REFERENCES users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_adjustments (    -- damaged or missing stock, posted only after approval
  id                SERIAL         PRIMARY KEY,
  adjust_date       DATE           NOT NULL,
  product_id        INTEGER        NOT NULL REFERENCES products(id),
  quantity          INTEGER        NOT NULL CHECK (quantity > 0),
  reason            VARCHAR(20)    NOT NULL CHECK (reason IN ('damaged', 'missing', 'expired')),
  value             NUMERIC(14,2)  NOT NULL,
  journal_entry_id  INTEGER        REFERENCES journal_entries(id),
  approval_id       INTEGER,
  created_by        INTEGER        REFERENCES users(id),
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- ---------- Finance and Accounting ----------
CREATE TABLE IF NOT EXISTS expenses (
  id                SERIAL         PRIMARY KEY,
  expense_date      DATE           NOT NULL,
  department_id     VARCHAR(32)    REFERENCES departments(id),
  category          VARCHAR(40)    NOT NULL,
  description       VARCHAR(200)   NOT NULL,
  amount            NUMERIC(14,2)  NOT NULL CHECK (amount > 0),
  paid_from         VARCHAR(8)     NOT NULL CHECK (paid_from IN ('cash', 'bank')),
  journal_entry_id  INTEGER        REFERENCES journal_entries(id),
  approval_id       INTEGER,
  created_by        INTEGER        REFERENCES users(id),
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS money_movements (
  id                SERIAL         PRIMARY KEY,
  move_date         DATE           NOT NULL,
  kind              VARCHAR(24)    NOT NULL CHECK (kind IN ('customer_payment', 'member_contribution', 'producer_payment', 'supplier_payment', 'vat_payment', 'paye_payment', 'loan_repayment', 'cash_deposit')),
  department_id     VARCHAR(32)    REFERENCES departments(id),
  party             VARCHAR(80),
  amount            NUMERIC(14,2)  NOT NULL CHECK (amount > 0),
  account           VARCHAR(8)     NOT NULL CHECK (account IN ('cash', 'bank')),
  voucher_no        VARCHAR(20),
  journal_entry_id  INTEGER        REFERENCES journal_entries(id),
  approval_id       INTEGER,
  created_by        INTEGER        REFERENCES users(id),
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- Every action that needs a second person (separation of duties) waits here until approved.
CREATE TABLE IF NOT EXISTS approvals (
  id             SERIAL         PRIMARY KEY,
  kind           VARCHAR(20)    NOT NULL CHECK (kind IN ('expense', 'payment', 'journal', 'refund', 'stock_adjustment', 'payroll', 'budget')),
  amount         NUMERIC(14,2)  NOT NULL DEFAULT 0,
  summary        VARCHAR(255)   NOT NULL,
  payload        JSONB          NOT NULL,
  department_id  VARCHAR(32)    REFERENCES departments(id),
  approver_role  VARCHAR(20)    NOT NULL,
  status         VARCHAR(10)    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by   INTEGER        NOT NULL REFERENCES users(id),
  requested_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
  decided_by     INTEGER        REFERENCES users(id),
  decided_at     TIMESTAMPTZ,
  decision_note  VARCHAR(255),
  result_ref     VARCHAR(40)
);
CREATE INDEX IF NOT EXISTS ix_approvals_status ON approvals (status);

CREATE TABLE IF NOT EXISTS budgets (
  id             SERIAL         PRIMARY KEY,
  fin_year       VARCHAR(8)     NOT NULL REFERENCES fiscal_years(code),
  department_id  VARCHAR(32)    REFERENCES departments(id),
  category       VARCHAR(40)    NOT NULL,
  annual_amount  NUMERIC(14,2)  NOT NULL CHECK (annual_amount >= 0),
  status         VARCHAR(10)    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved')),
  prepared_by    INTEGER        REFERENCES users(id),
  approved_by    INTEGER        REFERENCES users(id),
  updated_at     TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_line ON budgets (fin_year, COALESCE(department_id, ''), category);

CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id                 SERIAL         PRIMARY KEY,
  account            VARCHAR(8)     NOT NULL CHECK (account IN ('bank', 'cash')),
  statement_date     DATE           NOT NULL,
  statement_balance  NUMERIC(14,2)  NOT NULL,
  ledger_balance     NUMERIC(14,2)  NOT NULL,
  difference         NUMERIC(14,2)  NOT NULL,
  notes              VARCHAR(255),
  reconciled_by      INTEGER        REFERENCES users(id),
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- ---------- Human Resources ----------
CREATE TABLE IF NOT EXISTS employees (
  id              SERIAL         PRIMARY KEY,
  employee_no     VARCHAR(10)    NOT NULL UNIQUE,
  full_name       VARCHAR(80)    NOT NULL,
  phone           VARCHAR(20),
  email           VARCHAR(80),
  job_title       VARCHAR(80)    NOT NULL,
  org_unit        VARCHAR(20)    NOT NULL REFERENCES org_units(id),
  department_id   VARCHAR(32)    REFERENCES departments(id),
  status          VARCHAR(12)    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'terminated')),
  start_date      DATE           NOT NULL,
  basic_salary    NUMERIC(12,2)  NOT NULL CHECK (basic_salary >= 0),
  allowances      NUMERIC(12,2)  NOT NULL DEFAULT 0,
  paye            NUMERIC(12,2)  NOT NULL DEFAULT 0,
  other_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  leave_days      NUMERIC(5,1)   NOT NULL DEFAULT 18,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id            SERIAL        PRIMARY KEY,
  employee_id   INTEGER       NOT NULL REFERENCES employees(id),
  leave_type    VARCHAR(20)   NOT NULL CHECK (leave_type IN ('annual', 'sick', 'family', 'unpaid', 'maternity')),
  start_date    DATE          NOT NULL,
  end_date      DATE          NOT NULL,
  days          NUMERIC(5,1)  NOT NULL CHECK (days > 0),
  reason        VARCHAR(200),
  status        VARCHAR(10)   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  recorded_by   INTEGER       REFERENCES users(id),
  decided_by    INTEGER       REFERENCES users(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS attendance (
  employee_id  INTEGER       NOT NULL REFERENCES employees(id),
  work_date    DATE          NOT NULL,
  status       VARCHAR(10)   NOT NULL CHECK (status IN ('present', 'absent', 'late', 'leave', 'off')),
  hours        NUMERIC(4,1)  NOT NULL DEFAULT 0,
  recorded_by  INTEGER       REFERENCES users(id),
  PRIMARY KEY (employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id                SERIAL         PRIMARY KEY,
  period            CHAR(7)        NOT NULL UNIQUE,   -- YYYY-MM
  status            VARCHAR(10)    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'paid', 'rejected')),
  total_gross       NUMERIC(14,2)  NOT NULL DEFAULT 0,
  total_deductions  NUMERIC(14,2)  NOT NULL DEFAULT 0,
  total_net         NUMERIC(14,2)  NOT NULL DEFAULT 0,
  prepared_by       INTEGER        REFERENCES users(id),
  approved_by       INTEGER        REFERENCES users(id),
  paid_by           INTEGER        REFERENCES users(id),
  paid_date         DATE,
  journal_entry_id  INTEGER        REFERENCES journal_entries(id),
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_lines (
  id               SERIAL         PRIMARY KEY,
  run_id           INTEGER        NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id      INTEGER        NOT NULL REFERENCES employees(id),
  department_id    VARCHAR(32)    REFERENCES departments(id),
  basic            NUMERIC(12,2)  NOT NULL,
  allowances       NUMERIC(12,2)  NOT NULL,
  gross            NUMERIC(12,2)  NOT NULL,
  paye             NUMERIC(12,2)  NOT NULL,
  other_deductions NUMERIC(12,2)  NOT NULL,
  net              NUMERIC(12,2)  NOT NULL
);

-- ---------- Reporting view ----------
CREATE OR REPLACE VIEW v_trial_balance AS
SELECT a.code, a.name, a.kind,
       COALESCE(SUM(l.debit), 0)  AS total_debit,
       COALESCE(SUM(l.credit), 0) AS total_credit
FROM accounts a
LEFT JOIN journal_lines l ON l.account_code = a.code
GROUP BY a.code, a.name, a.kind, a.sort_order
ORDER BY a.sort_order;
