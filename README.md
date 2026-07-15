<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/f2ff8e4c-0223-4400-85df-57407205a447

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Local API

The website now expects a local backend at `http://localhost:5000/api`.

1. Copy [server/.env.example](server/.env.example) to `server/.env` and set `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLIENT_ORIGIN`, and `GOOGLE_CLIENT_ID`.
2. Install the backend dependencies with `npm install` inside the [server](server) folder.
3. Start the API from the `server` folder with `npm run dev`, or run `npm run build` followed by `npm start`.

## Google OAuth Sign-In

The app supports Google Identity Services sign-in through the existing auth modal.

1. In Google Cloud Console, create or select a project.
2. Configure the OAuth consent screen and add your test users.
3. Create an OAuth 2.0 Client ID of type **Web application**.
4. Add these authorized JavaScript origins:
   - `http://localhost:3000`
   - your production frontend domain
5. Add these authorized redirect URIs:
   - `http://localhost:3000/auth/callback`
   - `http://127.0.0.1:3000/auth/callback` if you ever open the app on 127.0.0.1
   - your production callback URL
6. Set these env vars:
   - `server/.env`: `GOOGLE_CLIENT_ID=...`
   - root `.env.local`: `VITE_GOOGLE_CLIENT_ID=...`
   - root `.env.local`: `VITE_GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback`
7. Restart the frontend and backend, then open the auth modal and use the Google button.

The frontend renders the button with `accounts.google.com/gsi/client`, and the backend verifies the returned credential against Google before creating or reusing the local session cookie.
