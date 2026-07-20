#!/usr/bin/env python3
"""Unlock or close the user's KDE wallet for the WebKDE Plasma session."""

import hashlib
import os
import pathlib
import subprocess
import sys
import time


SERVICE = "org.kde.kwalletd6"
PATH = "/modules/kwalletd6"
INTERFACE = "org.kde.KWallet"
WALLET = "kdewallet"


def busctl(
    *arguments: str, timeout: int = 5, expect_reply: bool = True
) -> subprocess.CompletedProcess[str]:
    command = ["busctl", "--user", f"--timeout={timeout}s"]
    if not expect_reply:
        command.append("--expect-reply=no")
    return subprocess.run(
        [*command, *arguments],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def wallet_is_open() -> bool:
    result = busctl("call", SERVICE, PATH, INTERFACE, "isOpen", "s", WALLET)
    return result.returncode == 0 and result.stdout.strip() == "b true"


def wait_for_daemon() -> None:
    busctl(
        "call",
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "StartServiceByName",
        "su",
        SERVICE,
        "0",
    )
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        result = busctl(
            "call",
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "NameHasOwner",
            "s",
            SERVICE,
            timeout=2,
        )
        if result.returncode == 0 and result.stdout.strip() == "b true":
            return
        time.sleep(0.25)
    raise RuntimeError("kwalletd6 did not register on the user D-Bus within 30 seconds")


def stop_stale_wallet_processes() -> None:
    result = subprocess.run(
        [
            "systemctl",
            "--user",
            "list-units",
            "--type=service",
            "--all",
            "--plain",
            "--no-legend",
        ],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    units = []
    for line in result.stdout.splitlines():
        unit = line.split(maxsplit=1)[0] if line.split() else ""
        if "org.kde.kwalletd6" in unit or "org.kde.kwalletmanager" in unit:
            units.append(unit)
    if units:
        subprocess.run(
            ["systemctl", "--user", "stop", *units],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        result = busctl(
            "call",
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "NameHasOwner",
            "s",
            SERVICE,
            timeout=2,
        )
        if result.returncode == 0 and result.stdout.strip() == "b false":
            return
        time.sleep(0.25)


def unlock() -> None:
    credential_directory = pathlib.Path(os.environ["CREDENTIALS_DIRECTORY"])
    credential = credential_directory / "kwallet-password"
    salt = pathlib.Path.home() / ".local/share/kwalletd/kdewallet.salt"
    wallet = pathlib.Path.home() / ".local/share/kwalletd/kdewallet.kwl"
    if not credential.is_file():
        raise RuntimeError("the encrypted KWallet credential was not loaded")
    if not salt.exists():
        if wallet.exists():
            raise RuntimeError(f"KWallet salt is missing for the existing wallet: {salt}")
        salt.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        descriptor = os.open(salt, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            os.write(descriptor, os.urandom(56))
        finally:
            os.close(descriptor)
    if not salt.is_file() or salt.stat().st_size != 56:
        raise RuntimeError(f"KWallet salt must be a 56-byte regular file: {salt}")

    password = bytearray(credential.read_bytes())
    try:
        key = hashlib.pbkdf2_hmac("sha512", password, salt.read_bytes(), 50_000, 56)
    finally:
        password[:] = b"\0" * len(password)

    wait_for_daemon()
    if wallet_is_open():
        return
    stop_stale_wallet_processes()
    wait_for_daemon()
    result = busctl(
        "call",
        SERVICE,
        PATH,
        INTERFACE,
        "pamOpen",
        "sayi",
        WALLET,
        str(len(key)),
        *(str(value) for value in key),
        "0",
        expect_reply=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"KWallet pamOpen failed: {result.stderr.strip()}")

    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if wallet_is_open():
            return
        time.sleep(0.25)
    raise RuntimeError("KWallet rejected the configured password")


def lock() -> None:
    result = busctl("call", SERVICE, PATH, INTERFACE, "closeAllWallets")
    if result.returncode not in (0, 1):
        raise RuntimeError(f"KWallet closeAllWallets failed: {result.stderr.strip()}")


def main() -> int:
    try:
        command = sys.argv[1]
        if command == "unlock":
            unlock()
        elif command == "lock":
            lock()
        else:
            raise ValueError
    except (IndexError, ValueError):
        print(f"usage: {sys.argv[0]} unlock|lock", file=sys.stderr)
        return 2
    except (OSError, RuntimeError) as error:
        print(f"WebKDE wallet: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
