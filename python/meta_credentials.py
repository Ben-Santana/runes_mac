"""Keychain-only credential storage. JSON travels over pipes, never argv."""
import json
import sys

SERVICE = 'org.runes.meta-login.v1'


def operate(request):
    from meta_neural_py.identity.keychain import KeychainIdentityStore
    store = KeychainIdentityStore()
    store.service = SERVICE
    action = request.get('action')
    if action == 'save':
        username, password = request.get('username'), request.get('password')
        if not isinstance(username, str) or not username.strip() or not isinstance(password, str) or not password:
            raise ValueError('Enter your Meta email or phone number and password.')
        store._write('credentials', json.dumps({'username': username.strip(), 'password': password}).encode())
        return {'saved': True}
    if action == 'forget':
        s, query = store._query('credentials')
        status = s.SecItemDelete(query)
        if status not in (s.errSecSuccess, s.errSecItemNotFound):
            raise RuntimeError('Could not remove Meta credentials from Keychain.')
        return {'saved': False}
    raw = store._read('credentials')
    if action == 'load':
        return json.loads(raw) if raw else None
    return {'saved': raw is not None}


if __name__ == '__main__':
    try:
        print(json.dumps({'ok': True, 'value': operate(json.loads(sys.stdin.readline()))}), flush=True)
    except Exception:
        print(json.dumps({'ok': False}), flush=True)
