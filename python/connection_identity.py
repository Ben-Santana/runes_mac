"""Explicit identity selection. Bluetooth addresses are aliases, never ownership proofs.

Existing Keychain accounts remain the credential records. This file stores only
public address-to-account bindings after a successful authenticated connection.
"""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import uuid

from meta_neural_py.errors import IdentityStoreError
from meta_neural_py.identity.keychain import KeychainIdentityStore
from meta_neural_py.identity.store import Identity
from meta_neural_py.identity.trust import load_point, public_point


class IdentityBindings:
    def __init__(self, path=None):
        self.path = Path(path or os.environ.get('RUNES_IDENTITY_MAP', Path.home() / 'Library/Application Support/Runes/band-identities.json'))

    def read(self):
        if not self.path.exists():
            return {}
        try:
            record = json.loads(self.path.read_text())
            if record['version'] != 1 or not isinstance(record['aliases'], dict):
                raise ValueError()
            return {str(uuid.UUID(k)).upper(): str(uuid.UUID(v)).upper() for k, v in record['aliases'].items()}
        except (ValueError, KeyError, TypeError, OSError):
            raise IdentityStoreError('Saved identity bindings are unavailable. Existing Keychain identities were not changed.') from None

    def resolve(self, device_id):
        return self.read().get(device_id.upper(), device_id)

    def remember(self, device_id, account):
        aliases = self.read()
        if device_id.upper() == account.upper() and device_id.upper() not in aliases:
            return
        aliases[str(uuid.UUID(device_id)).upper()] = str(uuid.UUID(account)).upper()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(dir=self.path.parent, prefix='.band-identities-')
        try:
            with os.fdopen(fd, 'w') as file:
                json.dump({'version': 1, 'aliases': aliases}, file)
                file.flush()
                os.fsync(file.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)


class ConnectionIdentityStore:
    def __init__(self, device_id, account=None, pending=False, store=None, bindings=None):
        self.store = store if store is not None else KeychainIdentityStore()
        self.bindings = bindings if bindings is not None else IdentityBindings()
        self.device_id = device_id
        self.account = str(uuid.UUID(account)).upper() if account else self.bindings.resolve(device_id)
        self.pending = pending
        self.selected_identity = None

    def load(self, _device_id):
        if not self.pending:
            return self.store.load(self.account)
        record = self.store.load_pending(self.account)
        if record is None or record.stage not in ('finish', 'confirmed'):
            raise IdentityStoreError('This pending enrollment cannot authenticate. Choose a saved identity or explicitly resume setup.')
        self.selected_identity = Identity(record.private_key, load_point(record.band_point) if record.band_point else None, record.allow_missing_band_key)
        return self.selected_identity

    def load_pending(self, _device_id):
        return self.store.load_pending(self.account)

    def save(self, _device_id, identity):
        self.store.save(self.account, identity)

    def save_pending(self, _device_id, record):
        self.store.save_pending(self.account, record)

    def clear_pending(self, _device_id):
        self.store.clear_pending(self.account)

    def authenticated(self):
        # A pending candidate is never promoted or used as an automatic fallback.
        # Only an explicit choice can reach here, after Band.__aenter__ succeeds.
        if self.pending:
            if self.selected_identity is None:
                raise IdentityStoreError('Pending identity was not selected for authentication.')
            self.store.save(self.account, self.selected_identity)
            # Retain pending for inspection; future automatic connections use saved.
        self.bindings.remember(self.device_id, self.account)


def identity_catalog(store=None):
    store = store if store is not None else KeychainIdentityStore()
    security = store._security()
    query = {security.kSecClass: security.kSecClassGenericPassword,
             security.kSecAttrService: store.service,
             security.kSecReturnAttributes: True, security.kSecMatchLimit: security.kSecMatchLimitAll}
    status, items = security.SecItemCopyMatching(query, None)
    if status == security.errSecItemNotFound:
        return []
    if status != security.errSecSuccess:
        raise IdentityStoreError(f'Cannot list saved identities (Keychain status {status}).')
    rows = []
    for item in items or []:
        account = str(item.get(security.kSecAttrAccount, ''))
        pending = account.endswith('.pending')
        try:
            account = str(uuid.UUID(account.removesuffix('.pending'))).upper()
        except ValueError:
            continue
        try:
            record = store.load_pending(account) if pending else store.load(account)
            if record is None:
                continue
            key = record.private_key
            has_band_key = record.band_point is not None if pending else record.band_public_key is not None
            stage = record.stage if pending else ('verified' if has_band_key else 'host_verified')
            eligible = not pending or stage in ('finish', 'confirmed')
            rows.append({'account': account, 'pending': pending, 'stage': stage,
                         'fingerprint': hashlib.sha256(public_point(key.public_key())).hexdigest(),
                         'has_band_key': has_band_key, 'eligible': eligible})
        except Exception:
            rows.append({'account': account, 'pending': pending, 'stage': 'unavailable', 'eligible': False})
    return sorted(rows, key=lambda row: (row['account'], row['pending']))
