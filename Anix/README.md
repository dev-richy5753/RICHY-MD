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

The Render service serves the landing page from `/`, the installable pairing and analytics dashboard from `/app/`, and keeps `/health` for its health check. Set `TELEGRAM_BOT_USERNAME` (without `@`) and configure the public domain with BotFather's `/setdomain` command to enable Telegram Login Widget sign-in. The app verifies Telegram's signed login data with `BOT_TOKEN`; users can only manage sessions linked to their own Telegram account. Set the optional `TELEGRAM_BOT_URL` to an HTTPS `t.me` link to enable the landing-page Telegram buttons.

The dashboard is a Progressive Web App and can be installed from a supported mobile browser. It provides WhatsApp pairing, connection health, pairing activity, uptime, and reconnect analytics; it does not collect message content. Pairing telemetry is retained for 90 days.

An Android Capacitor wrapper opens the dashboard URL supplied at build time. After deploying the service and getting its new Render URL, set `RICHY_MD_APP_URL` to that URL ending in `/app/`. Build a debug APK with Node.js 22+, Java 21, and Android SDK platform/build tools 35 installed:

```sh
export RICHY_MD_APP_URL=https://your-new-service.onrender.com/app/
npm run android:apk
```

The script writes `website/downloads/Base-Tele-X-WA.apk`, which the landing page exposes for download. The download stays unavailable until that APK exists. This is a debug-signed test build, not a Play Store release. The wrapper requires an internet connection and the deployed dashboard/API to be available.

To enable pairing, configure `BOT_TOKEN`, `OWNER_TELEGRAM_ID`, and `TELEGRAM_BOT_USERNAME` privately in the service environment. Set the public app domain with BotFather's `/setdomain` command. Do not send bot tokens or WhatsApp pairing codes in chat or commit them to the repository.

Optional landing-page media belongs in `assets/videos/`: use `landing.mp4` for a muted looping background and `music.mp3` for visitor-controlled music. The site works without either file.

## Deploy on Render

The repository includes a Render Blueprint (`render.yaml`) and a Dockerfile. The Blueprint uses a free web service with an HTTP health endpoint at `/health`, allowing it to run on Render's Free plan. This is a limited, best-effort setup—not a 24/7 service: Render may spin it down after 15 minutes without inbound traffic, and its filesystem is ephemeral. WhatsApp login files, per-session settings, and Telegram panel data can be lost when the service restarts or spins down, in which case you must pair the WhatsApp number again. Use persistent storage and an always-on paid service if you need reliable sessions and continuous availability.

1. In Render choose **New + → Blueprint** and connect this GitHub repository. Render will read `render.yaml` from the repository root.
2. Provide `BOT_TOKEN` (from [@BotFather](https://t.me/BotFather)), `OWNER_TELEGRAM_ID` (your numeric Telegram user ID), and `TELEGRAM_BOT_USERNAME` (the bot username without `@`) when prompted. Keep credentials private; do not commit `.env`.
3. Review the Free web service, then apply the Blueprint. The Docker image includes Chromium for animated Telegram-sticker conversion.
4. Configure the bot's login domain with BotFather's `/setdomain` command, then wait for the deploy to become live. The service URL followed by `/health` should return `ok`; open `/app/` to use the dashboard. Open the Telegram bot and send `/start` to use the bot as well.
5. Existing WhatsApp sessions on another machine are not included in the GitHub repo and must be paired again.
6. Automatic deploys are enabled: later pushes to `main` deploy automatically. To trigger a deploy manually, open the Render service and choose **Manual Deploy → Deploy latest commit**.

The video and application code are included in the repository; credentials and session files are not. Existing WhatsApp sessions with an older saved menu image setting migrate to the video on first startup; `.setmenuimg` can still enable a custom photo, and `.setmenuimg reset` switches back to the video.
