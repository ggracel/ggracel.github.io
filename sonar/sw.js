// foqs.sonar service worker (29. 9. 2026). Namenoma brez predpomnjenja: aplikacija ima lastno preverjanje
// različice (version.json), zato vsak zahtevek gre na omrežje. Obstaja zato, da Android ponudi "Dodaj na začetni
// zaslon" in da bo pozneje lahko sprejemal push obvestila.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
