# MA — Full-stack Fragrance & Unstitched Store

A full-stack demo storefront using Node.js, Express and SQLite. The uploaded MA monogram is included as the primary brand logo.

## Requirements
- Node.js 18 or newer
- npm

## Run locally
```bash
npm install
npm start
```
Open http://localhost:3000

Store admin: http://localhost:3000/admin

## Initial local admin credentials
- Username: `admin`
- Password: `ChangeMe123!`

Change the password before any shared/public deployment. The initial account is created only when the database is first initialized. To change credentials, set environment variables before the first run:
- `ADMIN_USER`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- Optional `PORT`, `DB_FILE`

Example (PowerShell):
```powershell
$env:ADMIN_USER="storeadmin"
$env:ADMIN_PASSWORD="Use-A-Long-Unique-Password"
$env:SESSION_SECRET="replace-with-a-long-random-secret"
npm start
```

## Included functionality
### Storefront
- Responsive editorial homepage and mobile navigation
- Two categories only: perfumes/fragrances and unstitched clothing
- 24 seeded demo products (12 per category)
- Collection page, search, category filters and sorting
- Product quick view, wishlist and cart
- Checkout form for Cash on Delivery demo orders
- Real order records stored in SQLite; inventory is decremented transactionally
- Newsletter signups stored in SQLite

### Admin
- Session-based admin login
- Dashboard summary
- Order list and order status updates
- Product create/edit/archive
- Stock editing
- Newsletter subscriber list

## API routes
Public:
- `GET /api/health`
- `GET /api/products?category=&search=&sort=`
- `GET /api/products/:id`
- `POST /api/orders`
- `POST /api/newsletter`

Admin (login required):
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/me`
- `GET /api/admin/dashboard`
- `GET /api/admin/products`
- `POST /api/admin/products`
- `PUT /api/admin/products/:id`
- `DELETE /api/admin/products/:id` (archives)
- `GET /api/admin/orders`
- `PATCH /api/admin/orders/:id`
- `GET /api/admin/subscribers`

## Important production work still required
- Replace sample product names, prices, stock, attributes and images with approved business inventory.
- Unsplash image URLs are external sample imagery and need replacing with licensed/owned product photography.
- Add HTTPS, a persistent session store (not Express MemoryStore), CSRF protection/rate limiting, backups, logging and deployment secrets.
- Confirm shipping, returns, taxes, COD availability, contact details and legal policies.
- Integrate a real courier/fulfilment workflow if needed.
- No online payment gateway is integrated. COD demo checkout creates a database order but does not contact a courier.
- No customer account registration/login is included.
- No automated email/SMS notification is integrated.
- Admin login is for local demo; configure strong credentials and production security before public launch.

## Preview
Run the server and open `http://localhost:3000`. The preview is the actual running application, not a screenshot. The app requires `npm install` before first run.
