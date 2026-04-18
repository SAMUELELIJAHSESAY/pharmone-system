# 💊 PharmaCare - Professional Pharmacy Management System

A **fully functional, production-ready** pharmacy management SaaS application built with vanilla JavaScript, PostgreSQL, and Supabase. Manage inventory, process sales, track customers, and generate insights—all from a modern, responsive web interface.

![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen) ![Version](https://img.shields.io/badge/Version-1.0.0-blue) ![License](https://img.shields.io/badge/License-MIT-green)

---

## 🌟 **Key Features**

### 👥 **Role-Based Access Control**
- **Super Admin:** Platform-wide management (create pharmacies, manage all users, view analytics)
- **Pharmacy Admin:** Manage single pharmacy business (inventory, sales, staff, branches)
- **Salesman:** Process sales via Point of Sale, search products, manage customers

### 📦 **Inventory Management**
- Add, edit, and delete pharmaceutical products
- Track stock in **boxes + units** (e.g., "45 boxes + 8 units")
- Automatic stock reduction on sales
- **Low stock alerts** with configurable thresholds
- **Expiry date tracking** with expired/expiring soon indicators
- Complete stock history with audit logs

### 💰 **Sales & Invoicing System**
- Real-time Point of Sale (POS) interface
- Search and filter products instantly
- Multiple payment methods: **Cash, Mobile Money, Card**
- Automatic invoice generation with unique numbers
- Discount application support
- Receipt printing/modal display

### 👤 **Customer Management**
- Add and manage customer profiles
- Track purchase history
- Search customers by name or phone
- View customer details and transaction records

### 📊 **Analytics & Reports**
- **Daily/Weekly/Monthly** revenue tracking
- **Profit & Loss** calculations with cost tracking
- Revenue breakdown by payment method
- Top-selling products analysis
- 30-day revenue trends

### 🏢 **Multi-Location Support**
- Create and manage pharmacy branches
- Branch-specific feature toggles
- Separate stock tracking per branch
- Branch-level sales data

### 👨‍💼 **Staff Management**
- Add salesmen/staff to pharmacy
- Role assignment and management
- View staff performance and sales attribution

---

## 🏗️ **Architecture**

### Frontend (Client-Side)
```
Vanilla JavaScript (no frameworks)
├── HTML5 + CSS3 (responsive design)
├── Real-time UI updates
├── Modal system for forms
└── Toast notifications
```

### Backend (Server-Side)
```
Supabase (PostgreSQL + Auth)
├── 8 database tables with relationships
├── Row Level Security (RLS) policies
├── Real-time subscriptions ready
├── Automatic triggers and functions
└── Full-text search capability
```

### Database Schema
```
pharmacies         - Pharmacy tenants
│
├── profiles       - User accounts with roles
├── branches       - Pharmacy locations
├── products       - Drug inventory
├── customers      - Customer records
├── sales          - Sale transactions
├── sale_items     - Line items per sale
└── stock_logs     - Audit trail
```

---

## 🚀 **Quick Start**

### Prerequisites
- Node.js 16+
- Supabase account (free tier works)
- Modern web browser

### Installation (5 minutes)

```bash
# 1. Clone repository
git clone <your-repo-url>
cd pharm/project

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your Supabase credentials

# 4. Initialize database
# Run migrations (see SETUP_INSTRUCTIONS.md)

# 5. Start development server
npm run dev
```

### First Login
- Navigate to `http://localhost:5173`
- Click one of the **Demo Account** buttons
- Or manually enter: `admin@pharma.com` / `demo123456`

---

## 📱 **User Guide**

### Super Admin Dashboard
```
[Pharmacies] [All Users] [Overview]
├── Create new pharmacy with admin account
├── Monitor all users across platform
├── View total revenue and active pharmacies
└── Manage platform settings
```

### Pharmacy Admin Dashboard
```
[Dashboard] [Inventory] [Sales] [Customers] [Reports] [Staff] [Branches]
├── Dashboard: Today's revenue, sales count, low stock alerts
├── Inventory: Add products, manage stock, track expiry dates
├── Sales: View transactions, search invoices, process refunds
├── Customers: Add/edit customer profiles
├── Reports: P&L statements, revenue breakdown, top products
├── Staff: Add salesmen, manage users
└── Branches: Create locations, toggle features
```

### Salesman Dashboard
```
[Dashboard] [Point of Sale] [Customers]
├── Dashboard: Personal sales, daily summary, quick stats
├── Point of Sale: Select products, apply discount, complete sale
└── Customers: Add quick customers, view history
```

---

## 🔐 **Security Features**

✅ **Supabase Authentication:** Email + password with session management  
✅ **Row Level Security:** Users only access their pharmacy data  
✅ **Password Hashing:** Bcrypt via Supabase Auth  
✅ **HTTPS Ready:** Deploy on secure connections  
✅ **Environment Variables:** No hardcoded secrets  
✅ **Input Validation:** All forms validated client & server  
✅ **SQL Injection Protection:** Parameterized queries via Supabase SDK  

---

## 📊 **Database Schema Details**

### Tables (with RLS)

| Table | Rows | Purpose |
|-------|------|---------|
| `pharmacies` | 1+ | Tenant data (pharmacy businesses) |
| `profiles` | 3+ | User accounts with roles |
| `branches` | 1+ | Pharmacy locations |
| `products` | 15+ | Drug inventory |
| `customers` | 5+ | Customer records |
| `sales` | 100+ | Sale transactions |
| `sale_items` | 300+ | Sales line items |
| `stock_logs` | 1000+ | Stock audit trail |

### Key Relationships

```
pharmacy
├── has many users (profiles)
├── has many branches
├── has many products
├── has many customers
└── has many sales
    ├── references customer
    ├── has many sale_items
    │   ├── references product
    │   └── tracked in stock_logs
    └── references staff member
```

---

## 🎨 **UI/UX Design**

- **Modern SaaS Style:** Similar to Stripe, Notion dashboards
- **Responsive Design:** Works on desktop, tablet, mobile
- **Dark-Aware:** Light and dark color schemes support
- **Accessibility:** Semantic HTML, ARIA labels
- **Performance:** Optimized for fast load times
- **Animations:** Smooth transitions and loading states

---

## 📁 **Project Structure**

```
pharm/project/
├── index.html              # Main HTML entry
├── main.js                 # App initialization
├── style.css               # Global styles
├── .env                    # Environment variables ⚠️
├── package.json            # Dependencies
│
├── src/
│   ├── auth.js             # Authentication functions
│   ├── config.js           # Supabase configuration
│   ├── database.js         # All CRUD operations
│   ├── utils.js            # Helper functions
│   ├── components/
│   │   ├── sidebar.js      # Navigation sidebar
│   │   └── modal.js        # Modal system
│   └── views/
│       ├── app.js          # Main app shell
│       ├── login.js        # Login page
│       ├── admin/
│       │   ├── dashboard.js
│       │   ├── inventory.js
│       │   ├── sales.js
│       │   ├── customers.js
│       │   ├── reports.js
│       │   ├── staff.js
│       │   └── branches.js
│       ├── salesman/
│       │   ├── dashboard.js
│       │   └── pos.js
│       └── super-admin/
│           ├── dashboard.js
│           ├── pharmacies.js
│           └── users.js
│
├── supabase/
│   └── migrations/
│       ├── 20260417211400_create_pharmacy_management_system.sql
│       └── 20260417212444_seed_demo_accounts.sql
│
├── public/                 # Static assets
│
└── SETUP_INSTRUCTIONS.md   # Complete setup guide
```

---

## 🔧 **Configuration**

### Environment Variables (.env)
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

### Customization Points
- **Colors:** Edit CSS variables in `style.css` (`:root` section)
- **Currency:** Modify `formatCurrency()` in `utils.js`
- **Stock thresholds:** Set per-product in inventory UI
- **Invoice prefix:** Change in `createSale()` in `database.js`

---

## 📈 **Performance Metrics**

- **Page Load:** < 2 seconds (via CDN)
- **Database Queries:** Optimized with indexes
- **Real-time Updates:** Supabase Realtime ready
- **Mobile Performance:** Responsive, touch-optimized

---

## 🚀 **Deployment**

### Vercel (Recommended)
```bash
npm install -g vercel
vercel
```

### Netlify
1. Connect Git repository
2. Build: `npm run build`
3. Publish: `dist`

### Docker
```docker
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["npm", "run", "preview"]
```

### Traditional VPS
1. Install Node.js
2. `npm install && npm run build`
3. Serve `dist/` folder via nginx

---

## ✅ **Production Checklist**

- [ ] Environment variables configured
- [ ] Database migrations executed
- [ ] User accounts created and linked
- [ ] Demo data removed (optional)
- [ ] HTTPS certificate installed
- [ ] Backup strategy implemented
- [ ] Monitoring set up
- [ ] Email notifications configured
- [ ] User documentation provided
- [ ] Staff trained on system

---

## 🐛 **Known Limitations**

- No offline support (requires internet)
- No mobile app (web-based only, but responsive)
- No SMS/email notifications (can be added via Supabase functions)
- Single currency support (can be extended)
- No barcode scanning (can be integrated via device API)

---

## 🔄 **Future Enhancements**

- [ ] Barcode scanning for fast inventory
- [ ] SMS/Email notifications
- [ ] Multi-currency support
- [ ] Prescription management
- [ ] Insurance processing
- [ ] Mobile app (React Native)
- [ ] Offline mode with sync
- [ ] Advanced analytics dashboard
- [ ] Print receipts to thermal printers
- [ ] Multi-language support

---

## 📞 **Support**

### Documentation
- See `SETUP_INSTRUCTIONS.md` for detailed setup
- Check `src/database.js` for API reference
- Review migrations for database schema

### Troubleshooting
- Check browser console for errors
- Verify `.env` file configuration
- Ensure Supabase migrations ran successfully
- Check RLS policies if getting permission errors

---

## 📜 **License**

MIT License - Feel free to use for commercial projects

---

## 🙏 **Credits**

Built with:
- **Supabase** - Open source Firebase alternative
- **PostgreSQL** - Powerful open source database
- **Vite** - Next-generation build tool
- **Vanilla JS** - No framework bloat

---

## 📚 **Learning Resources**

- **Supabase:** https://supabase.com/docs
- **PostgreSQL:** https://www.postgresql.org/docs/
- **Vite:** https://vitejs.dev/guide/
- **JavaScript:** https://developer.mozilla.org/en-US/docs/Web/JavaScript
- **SQL:** https://www.postgresql.org/docs/current/sql-syntax.html

---

**Version:** 1.0.0  
**Status:** ✅ Production Ready  
**Last Updated:** April 2026

**Built for modern pharmacies. Simple. Powerful. Scalable.**

🚀 *Ready to manage your pharmacy better? Let's go!*
