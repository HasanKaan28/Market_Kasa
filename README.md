# 🛒 Market Kasa - Modern Barcode POS & Retail Inventory Management System

[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.2-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Electron](https://img.shields.io/badge/Electron-44.3-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Capacitor](https://img.shields.io/badge/Capacitor-8.5-119EFF?logo=capacitor&logoColor=white)](https://capacitorjs.com/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Market Kasa** is a modern, high-speed, offline-first Point of Sale (POS) and inventory management ecosystem built for retail markets, groceries, and convenience stores. Engineered with a unified codebase supporting desktop (Windows - Electron), mobile (Android - Capacitor), and progressive web app (PWA) deployment.

---

## ✨ Key Features

- ⚡ **Rapid Barcode Scanning:** Seamless integration with physical USB/Bluetooth handheld barcode scanners and mobile/tablet camera scanning via `html5-qrcode`.
- 📦 **Smart Catalog & Stock Control:** Barcode generation, multi-category sorting, low-stock threshold alerts, quick price adjustment, and bulk editing.
- 📒 **Customer Credit Ledger (Veresiye Defteri):** Manage customer open accounts, record partial payments, track credit history, and generate balance statements.
- 📊 **Analytics & Z-Reports:** Daily revenue breakdowns, gross profit analysis, top-selling product statistics, payment method analytics (Cash, Credit Card, On Account), and instant PDF receipt generation.
- 👥 **Role-Based Access Control (RBAC):** Admin and Cashier authorization tiers to secure store settings and reporting screens.
- 🔄 **Real-Time Multi-Device Sync:** Local-network synchronization powered by WebSocket (`ws`) enabling multi-terminal setups (main register + handheld floor stock scanners) without requiring cloud servers.
- ☁️ **Automated Cloud Backup:** Configurable synchronization to Google Sheets / Google Drive via Apps Script Webhooks.
- 📴 **Offline-First Resilience:** Zero downtime during internet outages—all transactions persist locally in Dexie.js (IndexedDB) and sync automatically when connectivity resumes.

---

## 🛠️ Technology Stack

| Component | Stack |
| :--- | :--- |
| **Frontend Framework** | React 19, Vite 6, Tailwind CSS 4 |
| **Desktop Platform** | Electron 44, Electron Builder (Windows .exe installer) |
| **Mobile Platform** | Capacitor 8.5 (Android APK) |
| **Client Database** | Dexie.js 4.0 (IndexedDB) |
| **Network & Sync** | WebSocket (`ws`), Google Drive Apps Script Webhooks |
| **Barcode & Receipts** | `html5-qrcode`, `jspdf`, `lucide-react` |

---

## 🚀 Installation & Running

### Prerequisites
- Node.js (v18.0.0+)
- npm or yarn package manager

### 1. Setup
```bash
# Clone the repository
git clone https://github.com/HasanKaan28/Market_Kasa.git
cd Market_Kasa

# Install dependencies
npm install
```

### 2. Development (Web & PWA)
```bash
npm run dev
```
Launches the web application with live HMR on `http://localhost:5173`.

### 3. Desktop Execution (Electron)
```bash
# Launch Electron desktop window
npm run electron:start

# Build standalone Windows installer (.exe)
npm run electron:installer
```

### 4. Android Build (Capacitor)
```bash
# Sync web build to Android project
npm run cap:sync

# Open in Android Studio
npm run cap:open
```

### 5. Automatic APK downloads from GitHub

GitHub Actions builds a debug APK automatically when changes are pushed to `main`.

- Go to the repository's **Actions** tab and open the latest **Build Android APK** run.
- Download the APK from the **Artifacts** section.
- To publish a permanent download under **Releases**, create and push a version tag:

```bash
git tag v1.1.0
git push origin v1.1.0
```

The APK will then be attached to the GitHub release for that tag. This workflow creates a debug APK for testing and internal distribution; a signed Play Store release requires an Android signing key and GitHub repository secrets.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
