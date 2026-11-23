# RICHY MD

This project runs a Telegram control bot for linked WhatsApp sessions.

## Requirements

- Node.js 22.12 or newer
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Your numeric Telegram user ID

## Setup

Run these commands from this directory (`Anix`):

```sh
npm install
cp .env.example .env
```

Edit `.env` and set `BOT_TOKEN` and `OWNER_TELEGRAM_ID`. Keep `.env` private; it contains credentials.

## Run

```sh
npm start
```

Run the focused automated tests with `npm test`.

Open the Telegram bot and use `/pair` to link a WhatsApp number. Existing paired sessions saved in `session/` are restored automatically. Keep that directory private and backed up; it contains WhatsApp login credentials.

In WhatsApp, `.tgsticker <Telegram pack link> [number to send]` sends stickers from a public Telegram sticker pack, starting at the first sticker. It sends one by default and accepts up to 30 per command (for example, `.tgsticker https://t.me/addstickers/PackName 30`). Static, animated TGS, and video WebM stickers are supported; animated formats are converted to WebP. Animated TGS conversion requires Chromium's Linux runtime libraries to be available on the host.

`.ask <question>` and `.ai <question>` share recent conversation context in each chat; reply to a text message with either command to ask about it, and use `.ask reset` to clear that chat's in-memory AI history. The AI service receives the prompt and recent context over the network; history is not saved to disk and resets when the process restarts. `.autoreply on` enables conversational AI replies (DMs, and groups only when mentioned or replied to). Status views and reactions run as soon as a new status event arrives, in parallel, using the configured `.statusemoji` list; delivery timing and visibility still depend on WhatsApp connectivity and privacy/read-receipt settings. `.menu` uses the bundled `assets/menu.mp4` in both WhatsApp and Telegram while keeping the existing command buttons. `.vv2` sends replied-to view-once media to the command user's private chat; `.vv` keeps its existing behavior and replies in the current chat.

The menu also includes utility, game, and group commands: `.calc (12 + 8) * 3`, `.roll 2d6`, `.choose tea | coffee`, `.rps rock`, `.guess`, `.trivia`, `.poll question | option 1 | option 2`, `.remind 30m call mum`, `.reminders`, `.cancelreminder <id>`, `.weather <city>`, `.translate <language code> <text>`, `.qr <text>`, and `.sticker` (reply to a photo or short video). Reminders are saved with each WhatsApp session and restored after reconnecting. QR codes are generated locally; weather and translation use public online services. `.getpfp` is an alias for `.getdp`, and `.checkdevice` reports only the bot's own linked-session diagnostics.

For the standalone WhatsApp pairing flow, run `npm run dev` and follow the terminal prompt. `npm run vf` is an optional dependency/update monitor, not required to run the bot.

## Website and app download

The Render service serves the landing page from `/`, the installable pairing and analytics app from `/app/`, and keeps `/health` for its health check. Pairing uses a signed, private browser session; users enter their WhatsApp number directly and do not need Telegram sign-in. `TELEGRAM_BOT_USERNAME` and the optional `TELEGRAM_BOT_URL` are only for Telegram bot links.

The app is a Progressive Web App and can be installed from a supported mobile browser. It provides WhatsApp pairing, connection health, pairing activity, uptime, and reconnect analytics. Only the password-protected admin panel can display recorded message text or control optional recording for WhatsApp sessions paired from the current browser; ordinary app users cannot view message contents. Recording is off by default; enabling it requires confirming that affected participants were informed and consented, and that the bot administrator can view the records. When enabled, incoming texts, bot replies, and texts sent from the linked WhatsApp account are retained with sender/chat details for up to 24 hours, and deleted immediately when recording is stopped. WhatsApp Channel posts and status updates are excluded. Each browser owner's recordings are stored in a separate file under `session/.panel/messages/`; the admin panel displays opted-in recordings separately by WhatsApp number. Media and attachments are not saved. Pairing telemetry is retained for 90 days. Each browser gets its own signed session cookie to keep its session list private.

To run the website and WhatsApp pairing API without starting the Telegram control bot, use `npm run start:web`. This restores app-owned WhatsApp sessions but does not manage Telegram-owned sessions. If `APP_SESSION_SECRET` is unset, local runs create a private persistent key in `session/.panel/`; Render generates the setting from `render.yaml`. This keeps browser identities stable across restarts. Admin access uses `ADMIN_PASSWORD` and does not require Telegram sign-in; keep the password private.

The hidden admin entry is revealed by tapping **Pair with confidence** five times on the landing page. Enter the server-configured admin password to sign in. Admin sessions expire after one hour, and repeated failed password attempts are temporarily rate-limited. The panel lists saved WhatsApp sessions from all browser owners but never reveals pairing codes; the regular app shows only sessions paired from the current browser. Message text is limited to existing app sessions with recording enabled and participant consent. Recording is not expanded to Telegram-managed sessions.

An Android Capacitor wrapper opens the app URL supplied at build time. After deploying the service and getting its new Render URL, set `RICHY_MD_APP_URL` to that URL ending in `/app/`. Android builds reject local and Codespaces hosts so the downloadable app cannot show a Codespaces access prompt. The APK contains the client-side app assets and public service URL, not backend source or credentials; client-side assets are inspectable by design. Build a debug APK with Node.js 22+, Java 21, and Android SDK platform/build tools 35 installed:

```sh
export RICHY_MD_APP_URL=https://your-new-service.onrender.com/app/
npm run android:apk
```

The script writes `website/downloads/Base-Tele-X-WA.apk`, which the landing page exposes for download. The APK is git-ignored by default to prevent accidentally publishing a Codespaces build; after verifying a build targeted at Render, use `git add -f website/downloads/Base-Tele-X-WA.apk` to include it in the next website deployment. The download stays unavailable until an APK is included. This is a debug-signed test build, not a Play Store release. The wrapper requires an internet connection and the deployed dashboard/API to be available.

For the Telegram control bot, configure `BOT_TOKEN` and `OWNER_TELEGRAM_ID` privately in the service environment. `TELEGRAM_BOT_USERNAME` is only used for Telegram bot links. To enable the admin panel, set `ADMIN_PASSWORD` privately in the service environment. Do not send credentials or WhatsApp pairing codes in chat or commit them to the repository.

RICHY MD media lives in `assets/videos/`: `app-theme.mp4` is the muted app background, `montagem.mp4` is retained but not displayed on the website, and `music.mp3` is the app soundtrack. The uploaded audio source is retained as `music-source.m4a`. The supplied app icon is in `assets/images/richy-md-icon.png`; optimized copies are used where appropriate. The app attempts to autoplay music; browser policies may require a first tap, while the Android wrapper enables autoplay.

## Deploy on Render

The repository includes a Render Blueprint (`render.yaml`) and a Dockerfile. The Blueprint uses a free web service with an HTTP health endpoint at `/health`, allowing it to run on Render's Free plan. This is a limited, best-effort setup—not a 24/7 service: Render may spin it down after 15 minutes without inbound traffic, and its filesystem is ephemeral. WhatsApp login files, per-session settings, and Telegram panel data can be lost when the service restarts or spins down, in which case you must pair the WhatsApp number again. Use persistent storage and an always-on paid service if you need reliable sessions and continuous availability.

1. In Render choose **New + → Blueprint** and connect this GitHub repository. Render will read `render.yaml` from the repository root and create the `richy-md` service. Render will assign the service its own URL; do not reuse a deleted service URL or a Codespaces URL.
2. Provide `BOT_TOKEN` (from [@BotFather](https://t.me/BotFather)) and `OWNER_TELEGRAM_ID` (your numeric Telegram user ID) if you want the Telegram control bot. `TELEGRAM_BOT_USERNAME` is optional and only needed for Telegram bot links.
3. If enabling the hidden admin panel, set a private `ADMIN_PASSWORD` in the Render environment. Keep all credentials private; do not commit them.
4. Review the Free web service, then apply the Blueprint. The Docker image includes Chromium for animated Telegram-sticker conversion.
5. Wait for the deploy to become live. The service URL followed by `/health` should return `ok`; open `/app/` to enter your WhatsApp number and request a linking code. Open the Telegram bot and send `/start` to use the bot as well.
6. Existing WhatsApp sessions on another machine are not included in the GitHub repo and must be paired again.
7. Automatic deploys are enabled: later pushes to `main` deploy automatically. To trigger a deploy manually, open the Render service and choose **Manual Deploy → Deploy latest commit**.
8. Optionally add a GitHub Actions repository variable named `RENDER_HEALTH_URL` with the new service's base URL (for example `https://richy-md.onrender.com`) to enable the scheduled health-check workflow. It skips automatically until this variable is configured.

The video and application code are included in the repository; credentials and session files are not. Existing WhatsApp sessions with an older saved menu image setting migrate to the video on first startup; `.setmenuimg` can still enable a custom photo, and `.setmenuimg reset` switches back to the video.
