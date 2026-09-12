# NikhilWorks Ledger — self-hosted setup guide

A private tool for NikhilWorks: track clients, their **multiple projects /
services**, month-by-month payments, and generate Proforma Invoices, Tax
Invoices and Letterheads on your own branding. Also tracks work you've
**outsourced** to a vendor — what you owe them and what you've paid —
separately from what the client owes you. Runs on plain PHP + MySQL, so it
works on the same kind of shared hosting your nikhilworks.com site already
runs on (cPanel, File Manager, phpMyAdmin — no special server access
needed).

This guide assumes no prior server experience. Follow the steps in order.

> **Already have this running with real client data?** Don't re-import
> `schema.sql` over your live database — that's for brand-new installs
> only. Instead, run `migrations/v1_to_v2.sql` on your existing database
> (same steps as importing `schema.sql`: phpMyAdmin → your database →
> Import → choose the file → Go). It safely moves every existing client's
> service/amount/status into the new `projects` table, keeps all their
> payments and invoices correctly linked, and doesn't delete anything.
> It's also safe to run more than once if you're ever unsure whether it
> already ran.

---

## What you need first

- Your hosting cPanel login (the same account nikhilworks.com is on, or a
  new hosting account/subdomain — either works).
- 10–15 minutes.

You'll be creating a **new MySQL database** for this tool. It does not
touch your existing website's database or files.

---

## Step 1 — Create a MySQL database in cPanel

1. Log in to cPanel → open **MySQL Databases**.
2. Under "Create New Database", enter a name like `ledger` (cPanel will
   prefix it automatically, e.g. `nikhilw1_ledger`) → **Create Database**.
3. Under "MySQL Users" → "Add New User", create a username (e.g.
   `nikhilw1_ledgeruser`) and a **strong password** → **Create User**.
   Save this password somewhere safe — you'll need it in Step 3.
4. Under "Add User to Database", select the user and the database you
   just created → **Add** → on the next screen, tick **ALL PRIVILEGES** →
   **Make Changes**.

You should now have three things noted down: the full database name, the
full username, and the password.

---

## Step 2 — Upload the files

1. In cPanel, open **File Manager**.
2. Decide where this tool should live. Two common choices:
   - A subdomain, e.g. `ledger.nikhilworks.com` → its own folder (cPanel
     shows you the folder when you create the subdomain under
     **Subdomains**).
   - A subfolder of your main site, e.g. `nikhilworks.com/ledger` → the
     `ledger` folder inside `public_html`.
3. Upload every file and folder from this package (`index.php`,
   `login.php`, `config.php`, `schema.sql`, `api/`, `assets/`,
   `includes/`, `install/`, `partials/`, `.htaccess`, and the `.htaccess`
   files inside `includes/` and `partials/`) into that folder, keeping the
   same folder structure. Use File Manager's "Upload" or upload the whole
   thing as a `.zip` and use "Extract".

**Important:** make sure the `includes` and `partials` folders (and the
`.htaccess` files inside them) come along — they're what keep your
database password and internal files from being viewable in a browser.

---

## Step 3 — Import the database structure

1. In cPanel, open **phpMyAdmin**.
2. In the left sidebar, click the database you created in Step 1.
3. Click the **Import** tab.
4. Click **Choose File**, select `schema.sql` from this package, then
   click **Go** at the bottom.
5. You should see a success message and seven new tables listed on the
   left: `admin_users`, `clients`, `projects`, `payments`, `vendor_payments`,
   `invoices`, `settings`.

This also pre-fills your business details (Nikhil Works, GSTIN, PAN, bank
details, invoice numbering) into the `settings` table — you can review or
change any of it later from the Settings page inside the tool.

---

## Step 4 — Connect the app to your database

1. Back in File Manager, open `config.php` for editing (right-click →
   **Edit**, or **Code Editor**).
2. Fill in the four database values from Step 1:

   ```php
   define('DB_HOST', 'localhost');       // almost always "localhost" on shared hosting
   define('DB_NAME', 'nikhilw1_ledger');       // your real database name
   define('DB_USER', 'nikhilw1_ledgeruser');   // your real database username
   define('DB_PASS', 'the-password-you-set');  // your real database password
   ```

3. Also change this line to any long random text of your own (mash the
   keyboard) — it just needs to stay the same going forward, it isn't
   something you need to remember:

   ```php
   define('APP_SECRET', 'change-this-to-a-long-random-string-before-going-live');
   ```

4. Save the file.

---

## Step 5 — Create your admin login

1. Visit `https://yourdomain/install/setup.php` in your browser (using
   wherever you uploaded the app — e.g.
   `https://ledger.nikhilworks.com/install/setup.php`).
2. Choose a username and a password (at least 8 characters) → **Create
   Account**.
3. This page **only works once** — the moment an admin account exists, it
   locks itself and redirects to the login page instead. So there's no
   need to delete or hide the `install` folder afterwards, but you're
   welcome to remove it later if you'd rather not have it sitting there.

---

## Step 6 — Log in and start using it

Visit `https://yourdomain/login.php`, sign in with the account you just
created, and you're in. From there:

- **Dashboard** — a live overview across all clients and projects: total
  billed, received, pending, and which projects still owe money.
- **Clients** — add a client (name, contact, GSTIN, state, address). The
  same "New Client" form also has an optional **first project** section —
  give it a title, amount, start date, status, and (if you've already
  been paid something) how much you've received so far — and the client,
  their first project, and that opening payment are all saved together in
  one go. Leave the project title blank to save just the contact and add
  projects later.
- **Client detail → Projects** — open any client to see all of their
  projects/services. Add more any time from here — each has its own
  total value, GST rate, start date and status. Tick **"this project is
  outsourced"** on any project to also track a vendor name, what you owe
  them, and payments you've made to them — completely separate from what
  the client owes you.
- **Payments** — record client payments against a specific project, any
  time, as many times as you like (e.g. one row per month for an ongoing
  retainer). The project's pending balance updates automatically.
- **Outsourcing** — a dedicated tab listing every outsourced project
  across all clients, with vendor cost, what you've paid them, and what's
  still owed.
- **Invoices** — generate a Proforma or Tax Invoice for any client,
  optionally tied to one of their projects (auto-fills the line item and
  GST rate, but you can still edit everything). Tax Invoices
  auto-calculate CGST+SGST or IGST depending on the client's state vs.
  your business state; print or "Save as PDF" from the browser's print
  dialog.
- **Letterhead** — write a one-off letter on NikhilWorks letterhead and
  print/save it as a PDF.
- **Settings** — your business details, bank details, and the invoice
  numbering prefixes/counters, editable any time.

Everything is saved directly to your MySQL database, so it's there next
time you log in, from any device or browser.

---

## Notes on security & data

- Only people who know your admin username and password can log in —
  there's no public sign-up page.
- Passwords are stored as secure one-way hashes, never in plain text.
- Invoice numbers are allocated safely even if two invoices are created
  at the exact same moment — the counter can't accidentally issue the
  same number twice.
- **Back up your database regularly.** In cPanel, phpMyAdmin → your
  database → **Export** → **Go** downloads a full backup file you can
  save somewhere safe. Do this every so often, especially before making
  bulk changes.
- If you ever forget your admin password, the simplest fix is: in
  phpMyAdmin, open the `admin_users` table and delete your row, then
  visit `/install/setup.php` again to create a fresh login.

---

## Troubleshooting

**"Could not connect to the database. Check config.php."**
Double-check the four `DB_*` values in `config.php` against exactly what
cPaneI shows under MySQL Databases — a typo in the database name or
username is the most common cause. Also confirm the user was added to the
database with ALL PRIVILEGES (Step 1.4).

**`install/setup.php` says "Database tables not found."**
The `schema.sql` file hasn't been imported yet — go back to Step 3.

**Blank white page anywhere.**
Almost always a PHP version mismatch. In cPanel, under **MultiPHP
Manager** (or **Select PHP Version**), set this app's domain/folder to
PHP 8.0 or newer.

**Logo or fonts don't show up.**
Confirm the whole `assets` folder (including `assets/img/`) uploaded
correctly and its files aren't set to unusual permissions — folders
should be 755 and files 644, which is the File Manager default.
