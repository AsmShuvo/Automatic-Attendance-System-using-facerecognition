"""One-time Gmail authorisation.

Opens a browser, asks you to sign in to the Gmail account that will SEND the
reports, and saves a refresh token to backend/gmail_token.json. Run once:

    source venv/bin/activate
    python backend/gmail_auth.py

Requires backend/gmail_client.json (your OAuth client id + secret).
"""
import os

from google_auth_oauthlib.flow import InstalledAppFlow

ROOT = os.path.dirname(os.path.abspath(__file__))
CLIENT_FILE = os.path.join(ROOT, "gmail_client.json")
TOKEN_FILE = os.path.join(ROOT, "gmail_token.json")
SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


def main():
    if not os.path.exists(CLIENT_FILE):
        raise SystemExit(
            f"Missing {CLIENT_FILE}.\n"
            "Create it from backend/gmail_client.example.json with your OAuth "
            "client id and secret."
        )
    flow = InstalledAppFlow.from_client_secrets_file(CLIENT_FILE, SCOPES)
    # Fixed port so the redirect URI is predictable: http://localhost:8765/
    # - Desktop-app client: works with no extra setup.
    # - Web-application client: add exactly  http://localhost:8765/
    #   to the client's "Authorized redirect URIs" in Google Cloud Console.
    print("Redirect URI in use: http://localhost:8765/")
    creds = flow.run_local_server(port=8765)
    with open(TOKEN_FILE, "w") as f:
        f.write(creds.to_json())
    print(f"Authorised. Token saved to {TOKEN_FILE}")


if __name__ == "__main__":
    main()
