# Instant disaster reporting without Wi-Fi

Principle: **save first, try every available channel, say honestly what happened.** Nothing waits for Wi-Fi, and nothing is
called delivered because it was saved, queued, handed to another app or transmitted.

## What happens when someone presses "Send emergency report"

1. The report (type, urgency, injuries, people, description, GPS or typed place, original time, needs, photos) is written to
   IndexedDB on the device. No login, server or network is involved. Status: **Saved on Device**.
2. `deliverReport` tries the enabled channels in the user's priority order (default below). A channel that cannot work says why
   immediately (no waiting). A bounded wait (10 s) lets a fast link finish; slower channels continue in the background.
3. If nothing is acknowledged the report stays queued: **Delivery Failed — Retry Available**, with the reason per channel.
   Retries run on a backoff (max 2 min), and immediately when a connection returns or a radio is plugged in.
4. After a radio/Bluetooth/server acknowledgement the **full** report and photos still go out over the internet when it exists
   (same `client_id`, so the server completes the same incident rather than creating a second one).

| # | Channel | Needs | What "success" means |
|---|---|---|---|
| 1 | Radio (LoRa/mesh) | LoRa bridge speaking the protocol below, over USB serial or BLE; Chromium browser | `TX` = transmitted (not delivered). `ACK` from a gateway = **Received by Gateway**. `OPACK` = **Acknowledged by Rescue Operator** |
| 2 | SMS | SMS gateway number (Twilio webhook below); phone | A browser can only open the messaging app with the text ready. The user presses Send. Shown as **Sending via SMS**, never delivered. A native wrapper may expose `window.VyraNative.sendSms` for silent Android sending (still unconfirmed) |
| 3 | Bluetooth | Nearby VYRA relay (BLE UART peripheral, protocol below); Chromium browser (not iOS Safari) | `TX` = **Transferred to Nearby Device** (not delivered). `ACK` = Received by Gateway |
| 4 | Internet | Any link: mobile data, Wi-Fi, Ethernet. `navigator.onLine` is only a hint | Server answered 200/201 = **Received by Gateway** (the VYRA API is the gateway). Label shows "Mobile Data" when the browser reports a cellular link, else "Internet" |
| 5 | Manual | none | QR code, exported file, copy message. Never marked delivered |

Priority and enabled channels are configurable under **Delivery channels** on `/report/saved` (stored in IndexedDB).

## Delivery statuses (exact labels)

Saved on Device · Sending via Radio · Sending via SMS · Sending via Mobile Data · Sending via Internet (non-cellular link;
added because "Mobile Data" would be false on Wi-Fi) · Transferred to Nearby Device · Received by Gateway · Acknowledged by
Rescue Operator · Delivery Failed — Retry Available. Logic: `src/lib/delivery/status.ts` (one pure function, used by every screen).
"Acknowledged by Rescue Operator" on the internet path = the server status moved out of `pending` (polled every 30 s).

## Compact emergency message (SMS / radio / BLE / QR)

`V1|<incident>|<dangers>|<sev>|<where>|<people>|<resources>|<time>|<callback>|<crc>` — ASCII, ≤160 chars, CRC-16/CCITT-FALSE.
Incident = the report's `client_id` as 22 base64url chars; time = the original incident time (unix seconds, base 36); resources
(SAR, BOAT, FIRE, MED, EVAC, AID, ROAD) are derived from the report. Definition and tests: `src/lib/delivery/compact.ts`,
`tests/delivery.test.ts`. Photos and attachments never travel this way; they stay on the device until the internet path.

## Bridge line protocol (radio and Bluetooth hardware)

Newline-terminated ASCII at 115200 baud (USB serial) or the Nordic UART service
(`6e400001-b5a3-f393-b0a9-e50e24dcca9e`; RX `…0002…` write, TX `…0003…` notify).

```
phone -> bridge   VYRA?
bridge -> phone   VYRA-BRIDGE|1|lora|<device id>        (radio)   or   VYRA-BRIDGE|1|relay|<device id>   (Bluetooth relay)
phone -> bridge   MSG|<compact message>
bridge -> phone   TX|<incident>             transmitted. NOT an acknowledgement
bridge -> phone   ERR|<incident>|<reason>   could not transmit
bridge -> phone   ACK|<incident>|<gateway>  a gateway got it and answered over the mesh   (verified)
bridge -> phone   OPACK|<incident>|<name>   a rescue operator acknowledged it             (verified)
```
The phone never sends a report to a device that does not answer the handshake. ACK/OPACK lines are stored the moment they
arrive, even if the screen is closed or the send timed out. Meshtastic and other mesh firmware are **not** supported directly:
a bridge must implement this protocol (a small firmware layer on top of your radio library).

## Gateway side

Set on the server: `GATEWAY_API_KEY` (≥16 chars; without it ingestion is off), optionally `TWILIO_AUTH_TOKEN` and `PUBLIC_BASE_URL`
for SMS. Run migration `supabase/migrations/016_multichannel_delivery.sql` (demo mode needs nothing).

- `POST /api/gateway/ingest` (Bearer key): `{gateway_id, messages:[{channel, raw}]}` → per-message `{ok, incident, report_id, duplicate, ack}`.
- `POST /api/gateway/sms`: Twilio "message comes in" webhook. Refuses unsigned requests; replies "VYRA ACK <incident>" by SMS.
  An unreadable message gets a reply saying it was **not** recorded.
- `scripts/gateway-bridge.mjs --radio` (receiver on a serial port), `--compact "<msg>"`, `--import <file>` (exported file with photos).

A short message creates a **partial** report (`partial=true`, `ingest_channel`). Responders see a banner on the case. When the
full report arrives (same `client_id`) it completes that report: details fill in, creation time, status, verification and
overrides are kept. A retransmission, or a short message arriving after the full report, returns `duplicate:true`.

## Honest limits

- This is a web app. Web Serial / Web Bluetooth exist only in Chromium browsers over HTTPS; iOS Safari has neither. SMS cannot
  be sent silently from a browser. Where a channel cannot work it reports so; nothing is simulated.
- Radio and SMS traffic is not encrypted. The short message holds location, needs and callback number, which responders need,
  and anyone who hears it could also submit a forged full report for that incident id before the owner does. Do not rely on
  this channel for anything secret; add end-to-end encryption before wide deployment.
- Radio/SMS reports are unverified and anonymous (they carry no account). They are linked to the account only if the device
  later syncs while signed in.
- Closed browser tabs cannot retry in the background (no background sync is claimed). Delivery resumes when the app is opened.
- Real LoRa hardware has not been exercised in this repository's tests; the protocol is tested with fake hardware.

## Manual test plan

1. Wi-Fi off, mobile data on: send a report → *Sending via Mobile Data* → *Received by Gateway*.
2. Airplane mode, nothing connected: send → *Saved on Device*, then *Delivery Failed — Retry Available* with reasons; report listed under `/report/saved`.
3. Cellular, no internet (phone): open `/report/saved` → *Send via SMS* → messaging app opens with the text; status stays *Sending via SMS (not confirmed)*. With the Twilio webhook live, the reply SMS "VYRA ACK …" is the confirmation you see.
4. Internet off, LoRa bridge plugged in: *Sending via Radio* → *Transmitted, not confirmed*; run `gateway-bridge.mjs --radio` on a connected machine → *Received by Gateway*; later, when a responder opens the case → *Acknowledged by Rescue Operator*.
5. Reconnect internet: the same report completes server-side (no duplicate); photos upload.
6. QR / Export file / Copy message work with everything off.
