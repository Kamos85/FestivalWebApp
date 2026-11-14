# Festival Sign

A tiny offline web app that shows big fullscreen text in your chosen colors, so friends can spot you in a crowd.

- **Fit to screen on:** text is shrunk and wrapped so it all fits.
- **Fit to screen off:** letters fill the full screen height; text that is too wide scrolls.
- Double-tap (or press back) to return to the setup screen.

Plain HTML/CSS/JS, no build step.

## Run locally

```bash
python3 -m http.server 8000
```

Open http://localhost:8000.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After a minute it is live at `https://<username>.github.io/<repo>/`.

## Install on Android (offline use)

1. Open the GitHub Pages URL in Chrome.
2. Menu **⋮ → Install app** (or **Add to Home screen**).
3. Launch it from the home-screen icon: it runs fullscreen and works without internet.

Test this before the festival: turn on airplane mode, close the app fully, and reopen it.

## Updating

The installed app serves its own cached copy. After changing any file, bump `CACHE` in `sw.js`
(e.g. `festival-sign-v2`), push, then open the app once while online and restart it.
