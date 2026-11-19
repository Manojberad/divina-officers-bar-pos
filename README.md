# BarTill — Offline-First Bar Management & POS System

A self-hosted, completely free, offline-capable Bar Management and POS web application inspired by the clean touch workflow of VesselTill. Built with **React + TypeScript + Tailwind CSS**, **Node.js + Express**, and **SQLite (`node:sqlite` in WAL mode)** — zero payment gateways, zero external APIs, and zero cloud dependencies.

Architecture, ER diagram, and module breakdown: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

---

## Quick Start

**Requirements:** Node.js **22.5+** (tested on Node 24).

```bash
# 1. Install dependencies (once, while setting up)
npm run install:all

# 2. Build the offline PWA frontend
npm run build

# 3. Start the server (auto-migrates & seeds sample data on first run)
npm start
```

Open **`http://localhost:4000`** on the host device, or **`http://<LAN-IP>:4000`** (printed in the terminal on startup) from any tablet or phone on the same Wi-Fi network.

Run the automated end-to-end test suite at any time:
```bash
npm test
```

Reset and re-seed sample data:
```bash
npm run seed
```

---

## Sample Login Credentials

For **Posted-In Officers**, the initial PIN is their **Service Number** (stored hashed with `scrypt`).

| Role | Name | Service Number | Initial PIN |
|---|---|---|---|
| **Admin** | Administrator | `ADMIN` | `ADMIN` |
| **Bartender** | Ravi Kumar | `BT001` | `BT001` |
| **Bar Member (Posted-In)** | Lt Col A. Sharma | `IC-51234` | `IC-51234` |
| **Bar Member (Posted-In)** | Maj R. Singh | `IC-62345` | `IC-62345` |
| **Bar Member (Posted-In)** | Capt P. Nair | `SS-41234` | `SS-41234` |
| **Bar Member (Posted-In)** | Col V. Rao | `IC-40001` | `IC-40001` |
| **Customer / User (TD)** | Maj K. Das (TD) | `TD-1001` | `TD-1001` |
| **Customer / User (TD)** | Capt S. Iyer (TD) | `TD-1002` | `TD-1002` |

---

## Deployment Modes

### Mode 1: Standalone on a Single Android Tablet (No PC Required)

Run both the server and SQLite database directly on the Android tablet using **Termux**:

1. Install **Termux** on the Android tablet.
2. Inside Termux, install Node.js and copy the project folder:
   ```bash
   pkg update && pkg install nodejs git
   cd ~/storage/shared/BarTill   # or clone/copy the project folder into ~
   npm start
   ```
3. Open Chrome on the same tablet and visit **`http://localhost:4000`**.
4. Tap Chrome's menu (**⋮**) → **Add to Home screen / Install app** to install BarTill as a fullscreen standalone **PWA**.

### Mode 2: Local Wi-Fi Network (Multiple Tablets + Customer QR Phones, No Internet)

All devices share **one authoritative SQLite database** on the server device:

1. Connect the host device (Android tablet running Termux, mini-PC, or laptop) and all client tablets/phones to the **same local Wi-Fi router or tablet hotspot** (internet cable can be unplugged).
2. Start the server on the host device:
   ```bash
   npm start
   ```
   The console prints all detected LAN URLs, e.g. `http://192.168.1.25:4000`.
3. On the **Bartender tablet**, open `http://<HOST-LAN-IP>:4000/pos`.
4. On the **Administrator device**, open `http://<HOST-LAN-IP>:4000/dashboard`.
5. In **Tables & QR**, verify that the local Wi-Fi URL matches `http://<HOST-LAN-IP>:4000`, then click **Print all active QR cards**. When a member scans a table QR code on Wi-Fi, it opens `/menu/<code>`, associates the order with that table, and pushes it live to the Bartender's order board via Server-Sent Events (SSE).

> **Optional Native Android APK (Capacitor):**  
> A ready `client/capacitor.config.json` is included. To wrap the web build into a native Android APK:
> ```bash
> cd client
> npm i @capacitor/core @capacitor/cli @capacitor/android
> npm run build
> npx cap add android
> npx cap sync android
> npx cap open android
> ```

---

## Offline Queue & Data Consistency Guarantees

- **Zero external dependencies:** All icons, SVG product images, charts, Excel/PDF generators, and QR generators run locally.
- **Idempotent offline order queue:** If a tablet temporarily loses Wi-Fi while placing an order, the order is stored in **IndexedDB** with a `client_uuid` and automatically replayed when connectivity returns. The server enforces `UNIQUE(client_uuid)` so replays never create duplicate orders.
- **Single-deduction inventory lock:** Inventory is deducted inside an atomic SQLite transaction when an order reaches `Served` (configurable to `Accepted`), guarded by `orders.stock_deducted = 1` and a partial unique index `uq_sale_once(order_id, product_id, type)`. Cancelling a served order (Admin only) writes a `sale_reversal` movement and restores stock.
- **24-hour customer approval window:** Closed member orders move to `pending` approval for 24 hours (configurable). Members can **Approve** or **Report Discrepancy** (which flags the order as `disputed` and notifies the Admin). A background job marks unapproved orders older than 24 hours as `expired` without deleting the transaction.

---

## Database Backup & Restoration

- **Automatic local backups:** Every 6 hours (configurable in **Settings**), the server writes a timestamped snapshot to `server/data/backups/` and retains the latest 20 snapshots.
- **Manual download:** Go to **Settings → Database Backup & Restore → Download Full Backup** to download a single portable `.json` file containing all tables and base64-encoded uploaded images.
- **Restore:** Click **Restore from JSON File** (or click **Restore** next to any on-disk snapshot). Before overwriting data, the server automatically saves a `pre-restore` snapshot in `server/data/backups/`.
