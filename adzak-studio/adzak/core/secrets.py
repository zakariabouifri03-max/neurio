"""API keys are never stored in files or hardcoded.

Lookup order: environment variable ADZAK_AI_API_KEY, then the OS credential store
(Windows Credential Manager via the optional `keyring` package, no admin rights needed).
"""
from __future__ import annotations

import os

from .errors import AppError

SERVICE = "ADZAK Creative Studio"
ENV_VAR = "ADZAK_AI_API_KEY"


def get_api_key(account: str = "ai-provider") -> str | None:
    env = os.environ.get(ENV_VAR)
    if env:
        return env.strip()
    try:
        import keyring  # type: ignore

        return keyring.get_password(SERVICE, account)
    except Exception:  # noqa: BLE001 - keyring is optional
        return None


def set_api_key(key: str, account: str = "ai-provider") -> None:
    try:
        import keyring  # type: ignore
    except ImportError as exc:
        raise AppError(
            "Secure key storage is unavailable. Set the ADZAK_AI_API_KEY environment variable instead."
        ) from exc
    try:
        keyring.set_password(SERVICE, account, key)
    except Exception as exc:  # noqa: BLE001
        raise AppError("Could not save the API key to the system credential store.") from exc


def delete_api_key(account: str = "ai-provider") -> None:
    try:
        import keyring  # type: ignore

        keyring.delete_password(SERVICE, account)
    except Exception:  # noqa: BLE001
        pass
