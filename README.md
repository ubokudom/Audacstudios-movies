# Cyberline Studio

A private web studio for your team to create **videos** (BytePlus Seedance 2.0 / 2.5) and **images** (BytePlus Seedream 5.0 / 4.5). Everyone signs in with one shared team password; everything made is kept in a shared library.

What it does:

- Video from text, from a starting (and ending) image, or from reference images, video and audio
- Images from text, or by editing and blending your own photos
- "Turn into video": animate any image from the library
- Choice of model, shape, length (4–30 s), quality (480p–1080p), sound on/off, seed
- A cost estimate before you press Create, and the real cost afterwards (from BytePlus token usage)
- Shared library with download, reuse settings and delete
- Works on phones

---

## 1. Get your BytePlus API key

1. Sign in at **console.byteplus.com** and open **ModelArk**.
2. Go to **Model activation** (or *Activate models*) and switch on the models you want:
   Dreamina Seedance 2.0 / 2.0 fast / 2.0 mini / 2.5 and Seedream 5.0 / 5.0 Pro / 4.5.
3. Buy a token plan or top up your balance (e.g. the $32 Light Plan). Check that the plan says it can be used **through the API**.
4. Go to **API keys** → **Create API key**. Copy it and keep it somewhere safe.

## 2. Put the app online with Vercel (free)

You need a free **GitHub** account and a free **Vercel** account (sign up at vercel.com with GitHub).

1. Unzip `cyberline-studio.zip`.
2. On github.com, click **New repository**, name it `cyberline-studio`, make it **Private**, create it.
3. Click **uploading an existing file** and drag in everything inside the unzipped folder (not the folder itself). Click **Commit changes**.
4. On vercel.com, click **Add New → Project**, pick the `cyberline-studio` repository, click **Deploy**. The first deploy will show a sign-in page that doesn't work yet; that's expected.
5. In the Vercel project, open **Storage → Create → Blob**. Name it `studio-media`, choose access **Public**, and connect it to this project. This is where videos and images are kept. (Files get long random links that can't be guessed.)
6. Open **Settings → Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `STUDIO_PASSWORD` | the password your team will use |
   | `SESSION_SECRET` | any long random text (40+ characters) |
   | `BYTEPLUS_API_KEY` | the key from step 1 |
   | `STUDIO_NAME` | optional, e.g. `Cyberline Studio` |

7. Go to **Deployments**, open the menu on the latest one and click **Redeploy**.
8. Open your site's address (e.g. `cyberline-studio.vercel.app`), sign in, and create something.

To use your own domain (e.g. `studio.yourdomain.com`), add it under **Settings → Domains** and follow Vercel's DNS instructions.

> Vercel's free Hobby plan is meant for personal, non-commercial use and stops a request after 60 seconds. If 4K images or 4-image batches time out, either create fewer at once or move to Vercel Pro and change `maxDuration` in `app/api/image/route.ts` to `300`.

## 3. Running it on your own server instead (optional)

Any host that runs Node.js 20+ works (a VPS, Hostinger's Node.js hosting, Render, Railway…). Without a Blob store, files are saved in a `data/` folder next to the app and only signed-in users can open them.

```bash
npm install
cp .env.example .env.local   # then edit the values
npm run build
npm start                    # serves on port 3000
```

Back up the `data/` folder; it holds your whole library.

---

## Things to know

- **Costs.** Video is billed by BytePlus in tokens (≈ width × height × 24 fps × seconds ÷ 1024). At $6.40 per million tokens, a 5-second 720p clip is about $0.69, and 1080p is about $1.56. The estimate on the Create button assumes your plan's rate; set `VIDEO_PRICE_PER_M_TOKENS` if you pay a different rate. Images show a cost only where a price is known (Seedream 5.0 Lite ≈ $0.035).
- **Failed or blocked requests** are shown in the library with the reason (content safety, balance, model not activated…) and are not charged by BytePlus.
- **Reference video and audio** must be public `https://` links BytePlus can download, under 15 seconds each.
- **Uploads** are shrunk in the browser to 1600 px before sending. Up to about 6 large photos can be sent in one request.
- **Signing out** everyone: change `SESSION_SECRET` and redeploy. Change `STUDIO_PASSWORD` to lock out old team members.

## If BytePlus renames a model

Model IDs are in `lib/config.ts`. You can edit them there, or override without touching code by adding a `VIDEO_MODELS` or `IMAGE_MODELS` environment variable, for example:

```json
[{"id":"dreamina-seedance-2-0-260128","label":"Seedance 2.0","note":"Best balance","maxDuration":15,"resolutions":["480p","720p","1080p"],"maxRefImages":9,"supportsAudio":true}]
```

Copy the exact ID from the model's page in your ModelArk console. If you see "BytePlus does not recognise this model ID" in the studio, this is the fix.

## How it's built

Next.js 15 (App Router), TypeScript, no database. Each creation is a small JSON record plus its media file, stored in Vercel Blob or on disk. The BytePlus calls are in `lib/byteplus.ts` (`POST /contents/generations/tasks` for video, `POST /images/generations` for images). Videos are checked every few seconds while the page is open and copied into your storage as soon as BytePlus finishes (BytePlus links expire after 24 hours).
