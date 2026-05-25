# House of Cambridge — E-Commerce Platform

A full-stack MERN e-commerce application for **House of Cambridge**, a Sri Lankan premium lifestyle and fashion retailer. Built with React 19, Express 5, MongoDB/Mongoose 9, and Redux Toolkit — matching a pixel-perfect Figma design across 37 screens.

---

## Tech Stack

### Frontend
| Technology | Version |
|---|---|
| React | 19 |
| Vite | 8 |
| Tailwind CSS | v4 |
| Redux Toolkit | 2.x |
| React Router | v7 |
| Axios | 1.x |
| React Icons | 5.x |
| React Hot Toast | 2.x |
| @react-oauth/google | 0.13.x |

### Backend
| Technology | Version |
|---|---|
| Node.js | 18+ |
| Express | 5 |
| Mongoose | 9 |
| jsonwebtoken | 9.x |
| Nodemailer | 8.x |
| Cloudinary SDK | v2 |
| multer | 2.x |
| bcryptjs | 3.x |
| helmet + cors + express-rate-limit | latest |

---

## Project Structure

```
House-of-Cambridge-E-commerce/
├── frontend/                        # React + Vite SPA
│   ├── public/
│   │   ├── favicon.svg              # HC monogram favicon
│   │   └── images/                  # Static assets, logos, hero slides
│   ├── src/
│   │   ├── components/
│   │   │   ├── common/              # Navbar, Footer, Layout
│   │   │   ├── profile/             # ProfileLayout, sidebar
│   │   │   ├── admin/               # AdminLayout, sidebar
│   │   │   └── ui/                  # ProductCard, Spinner, Breadcrumb, Toast
│   │   ├── pages/
│   │   │   ├── auth/                # Login, Register, ForgotPassword, ResetPassword, EmailVerification
│   │   │   ├── shop/                # ShopPage, ProductDetail, FlashSalePage
│   │   │   ├── cart/                # CartPage
│   │   │   ├── checkout/            # CheckoutPage, GuestCheckoutPage, PaymentProcessing, PaymentDenied
│   │   │   ├── orders/              # OrderConfirmation, OrderTracking, OrderHistory, ReturnRequest, ReturnStatus
│   │   │   ├── profile/             # ProfileDashboard, EditProfile, AddressManagement, Wishlist, NotificationCenter
│   │   │   ├── admin/               # AdminDashboard, AdminOrders, AdminOrderDetail, AdminProducts,
│   │   │   │                        #   AdminUsers, AdminCategories, AdminCoupons, AdminReviews,
│   │   │   │                        #   AdminReturns, AdminFlashSales, AdminBroadcast
│   │   │   ├── misc/                # AboutUs, ContactUs, FAQ, PrivacyPolicy, TermsAndConditions, Error404
│   │   │   └── Home.jsx
│   │   ├── redux/
│   │   │   ├── api/                 # axiosInstance.js (auth + error interceptors)
│   │   │   ├── slices/              # authSlice, productSlice, cartSlice, orderSlice, userSlice, adminSlice
│   │   │   └── store.js
│   │   ├── utils/
│   │   │   ├── invoiceGenerator.js  # PDF invoice builder (print-to-PDF)
│   │   │   └── categoryTree.js      # Flatten → tree transformer
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── .env                         # (gitignored) — see .env.example
│   ├── .env.example
│   └── package.json
│
└── backend/                         # Node.js + Express API
    ├── config/
    │   ├── db.js                    # MongoDB connection
    │   ├── cloudinary.js            # Cloudinary v2 config
    │   └── mailer.js                # Nodemailer SMTP transporter
    ├── model/                       # Mongoose schemas
    │   ├── User.js
    │   ├── Product.js
    │   ├── Category.js
    │   ├── Order.js
    │   ├── Cart.js
    │   ├── Wishlist.js
    │   ├── Review.js
    │   ├── Address.js
    │   ├── Coupon.js
    │   ├── Notification.js
    │   └── Return.js
    ├── middleware/
    │   ├── auth.js                  # protect / authorize / optionalAuth
    │   ├── errorHandler.js
    │   ├── logger.js
    │   └── upload.js                # multer + Cloudinary storage
    ├── repositories/                # Thin DB query layer
    │   ├── userRepository.js
    │   ├── productRepository.js
    │   ├── orderRepository.js
    │   └── cartRepository.js
    ├── services/                    # Business logic
    │   ├── authService.js
    │   ├── productService.js
    │   ├── cartService.js
    │   └── orderService.js
    ├── controllers/
    │   ├── authController.js
    │   ├── productController.js
    │   ├── cartController.js
    │   ├── orderController.js
    │   ├── userController.js
    │   └── adminController.js
    ├── routes/
    │   ├── authRoutes.js
    │   ├── productRoutes.js
    │   ├── cartRoutes.js
    │   ├── orderRoutes.js
    │   ├── userRoutes.js
    │   └── adminRoutes.js
    ├── utils/
    │   ├── errorResponse.js
    │   ├── sendToken.js
    │   ├── sendEmail.js
    │   ├── cloudinaryHelper.js
    │   └── apiFeatures.js           # search / filter / sort / paginate chaining
    ├── .env                         # (gitignored) — see .env.example
    ├── .env.example
    ├── server.js
    └── package.json
```

---

## Environment Variables

Copy each example file and fill in your credentials before running the app.

```bash
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env
```

### Backend — `backend/.env`

| Variable | Description |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | API server port (default `5000`) |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | Long random secret for signing JWTs |
| `JWT_EXPIRE` | JWT lifetime e.g. `7d` |
| `COOKIE_EXPIRE` | Cookie lifetime in days |
| `SMTP_HOST` | SMTP server host e.g. `smtp.gmail.com` |
| `SMTP_PORT` | SMTP port (587 for TLS) |
| `SMTP_USER` | SMTP login email |
| `SMTP_PASSWORD` | SMTP password / Gmail App Password |
| `FROM_EMAIL` | Sender address shown on outgoing emails |
| `FROM_NAME` | Sender display name |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `CLOUDINARY_FOLDER` | Root folder for all uploaded media |
| `FACEBOOK_APP_ID` | Facebook App ID for social login |
| `FACEBOOK_APP_SECRET` | Facebook App Secret |
| `CLIENT_URL` | Frontend origin for CORS + email links |
| `LOG_LEVEL` | `error` / `warn` / `info` / `debug` |

### Frontend — `frontend/.env`

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend API base URL (must end with `/api`) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID |
| `VITE_FACEBOOK_APP_ID` | Facebook App ID for JS SDK login |

---

## Getting Started

### Prerequisites
- Node.js 18+
- MongoDB Atlas account (or local MongoDB 6+)
- Cloudinary account (free tier is sufficient)
- Gmail account with 2FA + App Password for email, **or** any SMTP provider

### Installation

```bash
# Clone
git clone https://github.com/ima-69/House-of-Cambridge-E-commerce.git
cd House-of-Cambridge-E-commerce

# Backend
cd backend
npm install
cp .env.example .env   # then fill in your values

# Frontend
cd ../frontend
npm install
cp .env.example .env   # then fill in your values
```

### Running in Development

Open two terminals:

```bash
# Terminal 1 — API server  →  http://localhost:5000
cd backend && npm run dev

# Terminal 2 — Vite dev server  →  http://localhost:5173
cd frontend && npm run dev
```

### Creating a Super Admin

There is no separate admin registration page. The recommended approach is to register through the normal sign-up flow, then promote the account directly in the database.

**Step 1 — Register a normal account**

Go to `http://localhost:5173/register` and create an account with the email address you want to use as the super admin.

**Step 2 — Promote the account in MongoDB**

Open your database with [MongoDB Atlas](https://cloud.mongodb.com) (or MongoDB Compass for a local instance):

1. Navigate to your cluster → **Browse Collections** → select the `house-of-cambridge` database → open the `users` collection.
2. Find the document with your email address.
3. Click **Edit document** (pencil icon) and change the `role` field value from `"user"` to `"superadmin"`.
4. Save the document.

If you prefer the terminal, connect with `mongosh` and run:

```js
use house-of-cambridge
db.users.updateOne(
  { email: "your@email.com" },
  { $set: { role: "superadmin" } }
)
```

**Step 3 — Log in**

Log out if you are already signed in, then log back in at `/login`. You will now have access to the admin panel at `http://localhost:5173/admin`.

> **Roles** — `user` (default) · `admin` (manage content, no user deletion) · `superadmin` (full access including creating other admins and deleting users). A superadmin can promote other registered users to `admin` or `superadmin` from the Admin → Users panel without touching the database again.

---

## API Reference

### Auth — `/api/auth`
| Method | Endpoint | Access |
|---|---|---|
| POST | `/register` | Public |
| POST | `/login` | Public |
| POST | `/logout` | Private |
| GET | `/me` | Private |
| POST | `/forgot-password` | Public |
| PUT | `/reset-password/:token` | Public |
| GET | `/verify-email/:token` | Public |
| PUT | `/update-password` | Private |
| POST | `/social/google` | Public |
| POST | `/social/facebook` | Public |

### Products — `/api/products`
| Method | Endpoint | Access |
|---|---|---|
| GET | `/` | Public |
| GET | `/popular` | Public |
| GET | `/new-arrivals` | Public |
| GET | `/flash-sale` | Public |
| GET | `/featured` | Public |
| GET | `/:id` | Public |
| POST | `/:id/reviews` | Private |

### Cart — `/api/cart`
| Method | Endpoint | Access |
|---|---|---|
| GET | `/` | Optional Auth |
| POST | `/add` | Optional Auth |
| PUT | `/update` | Optional Auth |
| DELETE | `/item/:productId` | Optional Auth |
| POST | `/coupon` | Optional Auth |
| DELETE | `/coupon` | Optional Auth |

### Orders — `/api/orders`
| Method | Endpoint | Access |
|---|---|---|
| POST | `/` | Optional Auth |
| GET | `/my-orders` | Private |
| GET | `/:id` | Private |

### Users — `/api/users`
| Method | Endpoint | Access |
|---|---|---|
| GET | `/profile` | Private |
| PUT | `/profile` | Private |
| PUT | `/avatar` | Private |
| GET | `/addresses` | Private |
| POST | `/addresses` | Private |
| PUT | `/addresses/:id` | Private |
| DELETE | `/addresses/:id` | Private |
| GET | `/wishlist` | Private |
| POST | `/wishlist/toggle` | Private |
| GET | `/notifications` | Private |
| PUT | `/notifications/:id/read` | Private |
| PUT | `/notifications/read-all` | Private |

### Admin — `/api/admin`
| Method | Endpoint | Access |
|---|---|---|
| GET | `/dashboard` | Admin |
| GET/PUT/DELETE | `/users/:id` | Admin |
| POST | `/users/create-admin` | Super Admin |
| GET | `/orders` | Admin |
| GET | `/orders/:id` | Admin |
| PUT | `/orders/:id/status` | Admin |
| GET/POST/PUT/DELETE | `/products` | Admin |
| PUT | `/products/:id/flash-sale` | Admin |
| GET/POST/PUT/DELETE | `/categories` | Admin |
| GET/POST/PUT/DELETE | `/coupons` | Admin |
| GET | `/reviews` | Admin |
| PUT | `/reviews/:id/approve` | Admin |
| PUT | `/reviews/:id/reject` | Admin |
| DELETE | `/reviews/:id` | Admin |
| GET | `/returns` | Admin |
| GET | `/returns/:id` | Admin |
| PUT | `/returns/:id/status` | Admin |
| POST | `/notifications/broadcast` | Admin |

---

## Features

### Storefront
- Hero banner carousel with 3 slides and auto-rotation
- Flash sale section with real-time countdown timer
- Popular products section (ranked by order frequency)
- New arrivals section (products flagged `isNewArrival`)
- Beauty & Electronics category sections with live category filtering
- Category navigation grid with subcategory dropdowns
- Pre-Owned UK Items and New Arrivals nav badges with category trees

### Authentication
- JWT authentication stored in httpOnly cookies
- Email verification on registration
- Password reset via tokenised email link
- Social login: Google OAuth and Facebook JS SDK
- Remember me with persistent token

### Shopping
- Product listing with search, filter (category, price, brand, rating, pre-owned, new arrival) and sort
- Server-side pagination
- Product detail with image gallery, variant selection, and tabbed description/reviews
- Flash sale page with per-product countdown timers
- Wishlist with live badge count in the navbar

### Cart & Checkout
- Guest cart (session ID cookie) — no login required
- Coupon codes (percentage and fixed discount)
- Loyalty points: earn 1 pt per Rs. 50 spent, redeem at checkout (1 pt = Rs. 1 off)
- Free shipping threshold (Rs. 5,000+)
- 3-step checkout wizard: Address → Payment → Review
- Payment methods: Card, PayPal, KOKO, Cash on Delivery, Bank Transfer
- Payment status auto-set to `paid` on order creation for non-COD methods
- Double-submission protection on the Place Order button

### Orders
- Order confirmation page with loyalty points earned
- Order history with status tabs and search
- Shipment progress tracker (6-step timeline)
- Downloadable PDF invoice (browser print-to-PDF, no external library)
- Return request and return status tracking

### Admin Panel
- Dashboard with revenue, order, user, and stock KPIs
- Order management: update order status and payment status independently
- Product management: CRUD with Cloudinary image upload, flash sale toggle
- Category, coupon, review, and return management
- User management with loyalty point adjustment
- Broadcast notifications to all users

### User Profile
- Avatar upload via Cloudinary
- Multiple saved addresses with default flag
- Wishlist management
- Notification centre with read/unread state
- Loyalty points balance display
- Recent orders widget

### Design System
| Token | Value |
|---|---|
| Primary Accent | `#FFB700` |
| Background | `#FFFFFF` |
| Text Primary | `#1A1A1A` |
| Text Secondary | `#60717B` |
| Navbar / Footer | `#1A1A1A` |
| Footer Deep | `#171C26` |
| Flash Sale | `linear-gradient(90deg, #C20404, #FF5312)` |
| Border | `#E9E9E9` |

---

## Contact

- Website: houseofcambridge.co.uk
- Email: info@housecambridge.co.uk
- Phone: +94 11 234 5678

---

© 2026 House of Cambridge
