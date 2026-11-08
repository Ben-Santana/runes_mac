import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from cryptography.hazmat.primitives.asymmetric import ec
from meta_neural_py.errors import IdentityStoreError
from meta_neural_py.identity.store import Identity, MemoryIdentityStore, PendingEnrollment
from python.connection_identity import ConnectionIdentityStore, IdentityBindings, identity_catalog

A='11111111-1111-1111-1111-111111111111'
B='22222222-2222-2222-2222-222222222222'

class IdentitySelectionTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path=Path(self.directory.name)/'bindings.json'
        self.bindings=IdentityBindings(self.path)
        self.store=MemoryIdentityStore()
        self.saved=Identity(ec.generate_private_key(ec.SECP256R1()),None,True)
        self.store.save(A,self.saved)
        self.candidate=PendingEnrollment(ec.generate_private_key(ec.SECP256R1()),'confirmed',None,True)
        self.store.save_pending(A,self.candidate)

    def test_new_uuid_is_not_bound_or_copied_until_authentication(self):
        choice=ConnectionIdentityStore(B,A,store=self.store,bindings=self.bindings)
        self.assertIs(choice.load(B),self.saved)
        self.assertFalse(self.path.exists())
        self.assertIsNone(self.store.load(B))
        choice.authenticated()
        self.assertEqual(self.bindings.resolve(B),A)
        self.assertIs(ConnectionIdentityStore(B,store=self.store,bindings=self.bindings).load(B),self.saved)
        self.assertIs(self.store.load_pending(A),self.candidate)
        metadata=self.path.read_text()
        self.assertEqual(json.loads(metadata)['aliases'],{B:A})
        self.assertNotIn('private',metadata)

    def test_saved_wins_and_pending_is_only_promoted_when_explicitly_authenticated(self):
        choice=ConnectionIdentityStore(A,store=self.store,bindings=self.bindings)
        self.assertIs(choice.load(A),self.saved)
        pending=ConnectionIdentityStore(A,pending=True,store=self.store,bindings=self.bindings)
        self.assertIs(pending.load(A).private_key,self.candidate.private_key)
        self.assertIs(self.store.load(A),self.saved)
        pending.authenticated()
        self.assertIs(self.store.load(A).private_key,self.candidate.private_key)
        self.assertIs(self.store.load_pending(A),self.candidate)

    def test_pending_promotion_uses_the_authenticated_candidate_not_a_later_record(self):
        choice=ConnectionIdentityStore(A,pending=True,store=self.store,bindings=self.bindings)
        authenticated=choice.load(A)
        later=PendingEnrollment(ec.generate_private_key(ec.SECP256R1()),'confirmed',None,True)
        self.store.save_pending(A,later)
        choice.authenticated()
        self.assertIs(self.store.load(A),authenticated)
        self.assertIs(self.store.load_pending(A),later)

    def test_incomplete_pending_never_falls_through_to_enrollment(self):
        self.store.save_pending(A,PendingEnrollment(self.candidate.private_key,'identity',None,True))
        with self.assertRaises(IdentityStoreError):
            ConnectionIdentityStore(A,pending=True,store=self.store,bindings=self.bindings).load(A)
        self.assertIs(self.store.load(A),self.saved)

    def test_malformed_binding_fails_closed_without_touching_credentials(self):
        self.path.write_text('{"version":1,"aliases":{"bad":"bad"}}')
        with self.assertRaises(IdentityStoreError): self.bindings.resolve(B)
        self.assertIs(self.store.load(A),self.saved)

    def test_explicit_enrollment_can_repoint_alias_without_deleting_old_identity(self):
        self.bindings.remember(B,A)
        self.bindings.remember(B,B)
        self.assertEqual(self.bindings.resolve(B),B)
        self.assertIs(self.store.load(A),self.saved)

    def test_catalog_exposes_only_public_metadata(self):
        security=SimpleNamespace(kSecClass='class',kSecClassGenericPassword='password',kSecAttrService='service',kSecReturnAttributes='attrs',kSecMatchLimit='limit',kSecMatchLimitAll='all',kSecAttrAccount='account',errSecSuccess=0,errSecItemNotFound=-1)
        security.SecItemCopyMatching=lambda *_:(0,[{'account':A},{'account':A+'.pending'}])
        self.store._security=lambda:security
        self.store.service='test'
        rows=identity_catalog(self.store)
        self.assertEqual(len(rows),2)
        self.assertEqual(len(rows[0]['fingerprint']),64)
        self.assertNotEqual(rows[0]['fingerprint'],rows[1]['fingerprint'])
        self.assertFalse(rows[0]['has_band_key'])
        self.assertFalse(any('private' in k for row in rows for k in row))
