"""Send attendance reports by email through the Gmail API (OAuth2).

Credentials are read from local files that are git-ignored, so no secret is ever
committed:

    backend/gmail_client.json   OAuth client id + secret (you create this once)
    backend/gmail_token.json    refresh token, written by gmail_auth.py

Run the one-time authorisation before first use:

    source venv/bin/activate
    python backend/gmail_auth.py

After that the backend can send mail without any further interaction.
"""
from __future__ import annotations

import base64
import os
from email.mime.text import MIMEText

ROOT = os.path.dirname(os.path.abspath(__file__))
CLIENT_FILE = os.path.join(ROOT, "gmail_client.json")
TOKEN_FILE = os.path.join(ROOT, "gmail_token.json")

# Send-only scope: the app can send mail as the authorised account, nothing else.
SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


class MailNotConfigured(Exception):
    """Raised when the Gmail credentials/token are missing."""


def _load_credentials():
    """Load the stored OAuth credentials, refreshing the access token if needed."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    if not os.path.exists(TOKEN_FILE):
        raise MailNotConfigured(
            "gmail_token.json not found. Run: python backend/gmail_auth.py"
        )

    creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        with open(TOKEN_FILE, "w") as f:
            f.write(creds.to_json())
    if not creds or not creds.valid:
        raise MailNotConfigured(
            "Gmail credentials are invalid. Re-run: python backend/gmail_auth.py"
        )
    return creds


def send_email(to_addr: str, subject: str, body: str) -> None:
    """Send a plain-text email. Raises MailNotConfigured or the API error."""
    from googleapiclient.discovery import build

    creds = _load_credentials()
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)

    msg = MIMEText(body, "plain", "utf-8")
    msg["To"] = to_addr
    msg["Subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    service.users().messages().send(userId="me", body={"raw": raw}).execute()


def is_configured() -> bool:
    """True if the token file exists (auth has been done at least once)."""
    return os.path.exists(TOKEN_FILE)
