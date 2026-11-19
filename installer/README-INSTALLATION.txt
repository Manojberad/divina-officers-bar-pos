========================================================================
       DIVINA OFFICERS' BAR POS - STANDALONE OFFLINE INSTALLER
========================================================================

Works 100% OFFLINE on any Windows 10 / 11 (64-bit) laptop.
No internet, no Node.js install, and no IT knowledge required.

------------------------------------------------------------------------
1. ONE-TIME INSTALLATION ON A NEW STATION LAPTOP
------------------------------------------------------------------------
  Step 1: Copy this entire folder (or extract the ZIP file completely)
          onto the new laptop (or run directly from a USB pen drive).

  Step 2: Double-click:
             Install-Divina-Bar-POS.bat

  Step 3: Click "Yes" when Windows asks for Administrator permission.
          Wait ~10-20 seconds until "INSTALLATION COMPLETE!" appears.

  That's it! The installer automatically:
    - Installs everything (portable runtime, server, database, icons,
      product photos, Excel/PDF export engines) to C:\DivinaBarPOS
    - Configures Windows to start the Bar POS server silently every time
      the laptop powers on (even before Windows login)
    - Allows your local Mess Wi-Fi tablets & phones through Windows Firewall
    - Disables laptop sleep while plugged into AC power
    - Creates the "Divina Officers Bar POS" icon on the Desktop

------------------------------------------------------------------------
2. DAILY USE BY BARTENDER (ZERO SERVER COMMANDS!)
------------------------------------------------------------------------
  - Turn on the laptop and keep it plugged into power + connected to the
    Mess Wi-Fi router.
  - Double-click the "Divina Officers Bar POS" icon on the Desktop.
  - The app opens immediately in full-window POS mode.
  - Note: Even if the laptop restarts during the day, the server restarts
    automatically in the background.

------------------------------------------------------------------------
3. CONNECTING THE BARTENDER TABLET & MEMBER PHONES (PRIVATE WI-FI)
------------------------------------------------------------------------
  - Connect the Laptop, Bartender Tablet, and Member Phones to the SAME
    private Mess Wi-Fi router (no internet required).
  - Open Start Menu -> "Divina Officers Bar POS" -> "Show Wi-Fi Address"
    to see the laptop's local address, e.g.:
        http://192.168.1.50:4000
  - Open that address in Chrome/Safari on the Bartender Tablet and tap
    "Add to Home Screen" for a 1-tap tablet app icon.
  - Print Table QR codes from Admin -> Tables (QR codes automatically
    encode the laptop's local Wi-Fi URL).
  - TIP: Ask your Mess/Router admin once to reserve a fixed (Static DHCP)
    IP address for this laptop on the Wi-Fi router so the URL and Table
    QR codes never change after a router reboot.

------------------------------------------------------------------------
4. DEFAULT ACCOUNTS (CHANGE PINS ON FIRST LOGIN!)
------------------------------------------------------------------------
  Admin Account     : Service No = ADMIN   | PIN = ADMIN
  Bartender Account : Service No = BT001   | PIN = BT001

  You can bulk-import your station's Officers and Products/Categories
  from Excel directly inside the app (offline, no internet required).

------------------------------------------------------------------------
5. OFFLINE USB BACKUP & UPGRADES
------------------------------------------------------------------------
  - Automatic daily backups are saved locally in:
        C:\DivinaBarPOS\server\data\backups\
  - Weekly USB Backup: Plug in a USB pen drive and open:
        Start Menu -> "Divina Officers Bar POS" -> "Backup to USB Drive"
    This safely saves a live snapshot of the bar database, uploads, and
    auto-backups to the USB drive without interrupting active orders.
  - Upgrading later: Simply run a newer Install-Divina-Bar-POS.bat.
    Your existing database, orders, officers, and backups are preserved!
  - Uninstalling: Open Start Menu -> "Divina Officers Bar POS" ->
    "Uninstall Divina Bar POS" (keeps your bar database by default).
========================================================================
